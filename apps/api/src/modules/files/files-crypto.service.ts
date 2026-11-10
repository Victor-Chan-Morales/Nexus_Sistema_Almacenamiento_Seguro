import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import type { EntityManager } from 'typeorm';
import { FileVersion } from './entities/file-version.entity';
import { TenantEncryptionKey } from './entities/tenant-encryption-key.entity';

const FORMAT_VERSION = 1;
const OBJECT_MAGIC = Buffer.from('NXF1', 'ascii');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const DEK_BYTES = 32;
const INVALID_CONNECTION_DETAILS = 'No se pudieron descifrar los datos de conexión';

// Mismo candado transaccional para las escrituras de Files y el operador de rotación.
export function lockTenantEncryption(
  database: { query(sql: string, parameters: string[]): Promise<unknown> },
  organizationId: string,
): Promise<unknown> {
  return database.query("SELECT pg_advisory_xact_lock(hashtextextended('nexus/files/keys:' || $1, 0))", [organizationId]);
}

export interface EncryptedFile {
  bytes: Buffer;
  checksum: string;
  encryptedDek: string;
  formatVersion: number;
}

/** SPEC-802: datos de conexión propios de un destino. Solo existen dentro del servidor, cifrados en la base. */
export interface DestinationConnectionDetails {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  useSsl: boolean;
}

@Injectable()
export class FilesCryptoService {
  constructor(private readonly config: ConfigService) {}

  currentKeyVersion(): number {
    const configured = this.config.get<string>('FILES_MASTER_KEY_CURRENT_VERSION')?.trim() || '1';
    const version = Number(configured);
    if (!/^[1-9]\d*$/.test(configured) || !Number.isSafeInteger(version)) {
      throw new InternalServerErrorException('FILES_MASTER_KEY_CURRENT_VERSION debe ser un entero positivo');
    }
    return version;
  }

  externalKeyReference(organizationId: string, keyVersion = this.currentKeyVersion()): string {
    return `hkdf-sha256://env/${this.masterKeyVariable(keyVersion)}/${organizationId}/v${keyVersion}`;
  }

  keyVersionFromReference(reference: string, organizationId?: string): number {
    const match = /^hkdf-sha256:\/\/env\/(FILES_MASTER_KEY(?:_V[1-9]\d*)?)\/([^/]+)\/v([1-9]\d*)$/.exec(reference);
    const version = Number(match?.[3]);
    if (!match || !Number.isSafeInteger(version) || match[1] !== this.masterKeyVariable(version) ||
      (organizationId !== undefined && match[2] !== organizationId)) {
      throw new InternalServerErrorException('La referencia de la llave de la organización no es válida');
    }
    return version;
  }

  assertMasterKeyAvailable(version: number): void {
    this.masterKey(version);
  }

  async decryptStoredVersion(
    manager: EntityManager,
    organizationId: string,
    version: FileVersion,
    objectBytes: Buffer,
  ): Promise<Buffer> {
    const key = await manager.findOneBy(TenantEncryptionKey, { id: version.kekId, organizationId });
    if (!key) throw new InternalServerErrorException('No se encontró la llave de la versión');
    return this.decryptFile(
      organizationId, version.fileId, version.versionNumber, version.encryptedDek,
      version.checksum, objectBytes, this.keyVersionFromReference(key.externalReference, organizationId),
    );
  }

  encryptConnectionDetails(organizationId: string, value: string, keyVersion = this.currentKeyVersion()): string {
    return this.encryptText(value, `destination:${organizationId}:v1`, keyVersion);
  }

  decryptConnectionDetails(organizationId: string, value: string): string {
    return this.decryptText(value, `destination:${organizationId}:v1`);
  }

  connectionKeyVersion(value: string): number {
    const prefix = value.split('.', 1)[0];
    if (prefix === 'v1') return 1;
    const match = /^k([1-9]\d*)$/.exec(prefix);
    const version = Number(match?.[1]);
    if (!match || !Number.isSafeInteger(version)) throw new InternalServerErrorException(INVALID_CONNECTION_DETAILS);
    return version;
  }

  /**
   * Datos de conexión propios de un destino, o null si usa la configuración de entorno (`environment:*`).
   * Quien lo llame debe tratar el resultado como secreto: nunca lo devuelve una respuesta HTTP.
   */
  readDestinationDetails(organizationId: string, ciphertext: string): DestinationConnectionDetails | null {
    const parsed = JSON.parse(this.decryptConnectionDetails(organizationId, ciphertext)) as DestinationConnectionDetails;
    if (typeof parsed.endpoint === 'string' && parsed.endpoint.startsWith('environment:')) return null;
    return parsed;
  }

  encryptFile(
    organizationId: string,
    fileId: string,
    versionNumber: number,
    plaintext: Buffer,
    keyVersion = this.currentKeyVersion(),
  ): EncryptedFile {
    const dek = randomBytes(DEK_BYTES);
    const nonce = randomBytes(NONCE_BYTES);
    const aad = this.fileContext(organizationId, fileId, versionNumber);
    const cipher = createCipheriv('aes-256-gcm', dek, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      bytes: Buffer.concat([OBJECT_MAGIC, nonce, ciphertext, tag]),
      checksum: createHash('sha256').update(plaintext).digest('hex'),
      encryptedDek: this.wrapDek(dek, organizationId, fileId, versionNumber, keyVersion),
      formatVersion: FORMAT_VERSION,
    };
  }

  decryptFile(
    organizationId: string,
    fileId: string,
    versionNumber: number,
    encryptedDek: string,
    expectedChecksum: string,
    objectBytes: Buffer,
    keyVersion = 1,
  ): Buffer {
    if (
      objectBytes.length < OBJECT_MAGIC.length + NONCE_BYTES + TAG_BYTES ||
      !objectBytes.subarray(0, OBJECT_MAGIC.length).equals(OBJECT_MAGIC)
    ) {
      throw new InternalServerErrorException('El objeto almacenado tiene un formato inválido');
    }

    const nonceStart = OBJECT_MAGIC.length;
    const nonce = objectBytes.subarray(nonceStart, nonceStart + NONCE_BYTES);
    const tag = objectBytes.subarray(objectBytes.length - TAG_BYTES);
    const ciphertext = objectBytes.subarray(nonceStart + NONCE_BYTES, objectBytes.length - TAG_BYTES);
    const dek = this.unwrapDek(encryptedDek, organizationId, fileId, versionNumber, keyVersion);
    const decipher = createDecipheriv('aes-256-gcm', dek, nonce);
    decipher.setAAD(this.fileContext(organizationId, fileId, versionNumber));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const actualChecksum = createHash('sha256').update(plaintext).digest();
    const expected = Buffer.from(expectedChecksum, 'hex');

    if (expected.length !== actualChecksum.length || !timingSafeEqual(expected, actualChecksum)) {
      throw new InternalServerErrorException('No se pudo validar la integridad del archivo');
    }
    return plaintext;
  }

  rewrapDek(
    organizationId: string,
    fileId: string,
    versionNumber: number,
    encryptedDek: string,
    fromVersion: number,
    toVersion: number,
  ): string {
    const dek = this.unwrapDek(encryptedDek, organizationId, fileId, versionNumber, fromVersion);
    return this.wrapDek(dek, organizationId, fileId, versionNumber, toVersion);
  }

  private encryptText(value: string, context: string, keyVersion: number): string {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey(keyVersion), nonce);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const prefix = keyVersion === 1 ? 'v1' : `k${keyVersion}`;
    return `${prefix}.${nonce.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
  }

  private decryptText(value: string, context: string): string {
    const [, nonceText, tagText, ciphertextText, extra] = value.split('.');
    if (!nonceText || !tagText || !ciphertextText || extra !== undefined) {
      throw new InternalServerErrorException(INVALID_CONNECTION_DETAILS);
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.masterKey(this.connectionKeyVersion(value)),
        Buffer.from(nonceText, 'base64url'),
      );
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextText, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Mensaje propio: el error crudo de crypto no debe filtrarse.
      throw new InternalServerErrorException(INVALID_CONNECTION_DETAILS);
    }
  }

  private wrapDek(dek: Buffer, organizationId: string, fileId: string, versionNumber: number, keyVersion: number): string {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.tenantKek(organizationId, keyVersion), nonce);
    cipher.setAAD(this.dekContext(organizationId, fileId, versionNumber));
    const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
    return `v1.${nonce.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
  }

  private unwrapDek(value: string, organizationId: string, fileId: string, versionNumber: number, keyVersion: number): Buffer {
    const [version, nonceText, tagText, ciphertextText] = value.split('.');
    if (version !== 'v1' || !nonceText || !tagText || !ciphertextText) {
      throw new InternalServerErrorException('La referencia cifrada del archivo no es válida');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.tenantKek(organizationId, keyVersion),
      Buffer.from(nonceText, 'base64url'),
    );
    decipher.setAAD(this.dekContext(organizationId, fileId, versionNumber));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const dek = Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64url')),
      decipher.final(),
    ]);
    if (dek.length !== DEK_BYTES) {
      throw new InternalServerErrorException('La llave del archivo no es válida');
    }
    return dek;
  }

  private tenantKek(organizationId: string, keyVersion: number): Buffer {
    const masterKey = this.masterKey(keyVersion);
    return Buffer.from(
      hkdfSync('sha256', masterKey, Buffer.from(organizationId), Buffer.from(`nexus/files/tenant-kek/v${keyVersion}`), DEK_BYTES),
    );
  }

  private masterKeyVariable(version: number): string {
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new InternalServerErrorException('Versión de llave maestra inválida');
    }
    return version === 1 ? 'FILES_MASTER_KEY' : `FILES_MASTER_KEY_V${version}`;
  }

  private masterKey(version: number): Buffer {
    const variable = this.masterKeyVariable(version);
    const configured = this.config.get<string>(variable);
    if (!configured) {
      throw new InternalServerErrorException(`${variable} no está configurada`);
    }
    const key = Buffer.from(configured, 'base64');
    if (key.length !== DEK_BYTES) {
      throw new InternalServerErrorException(`${variable} debe ser una llave base64 de 32 bytes`);
    }
    return key;
  }

  private fileContext(organizationId: string, fileId: string, versionNumber: number): Buffer {
    return Buffer.from(`nexus/files/content/v1/${organizationId}/${fileId}/${versionNumber}`);
  }

  private dekContext(organizationId: string, fileId: string, versionNumber: number): Buffer {
    return Buffer.from(`nexus/files/dek/v1/${organizationId}/${fileId}/${versionNumber}`);
  }
}
