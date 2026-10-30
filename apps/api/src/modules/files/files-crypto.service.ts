import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "crypto";

const FORMAT_VERSION = 1;
const OBJECT_MAGIC = Buffer.from("NXF1", "ascii");
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const DEK_BYTES = 32;

export interface EncryptedFile {
  bytes: Buffer;
  checksum: string;
  encryptedDek: string;
  formatVersion: number;
}

@Injectable()
export class FilesCryptoService {
  constructor(private readonly config: ConfigService) {}

  externalKeyReference(organizationId: string): string {
    return `hkdf-sha256://env/FILES_MASTER_KEY/${organizationId}/v1`;
  }

  encryptConnectionDetails(organizationId: string, value: string): string {
    return this.encryptText(value, `destination:${organizationId}:v1`);
  }

  encryptFile(
    organizationId: string,
    fileId: string,
    versionNumber: number,
    plaintext: Buffer,
  ): EncryptedFile {
    const dek = randomBytes(DEK_BYTES);
    const nonce = randomBytes(NONCE_BYTES);
    const aad = this.fileContext(organizationId, fileId, versionNumber);
    const cipher = createCipheriv("aes-256-gcm", dek, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return {
      bytes: Buffer.concat([OBJECT_MAGIC, nonce, ciphertext, tag]),
      checksum: createHash("sha256").update(plaintext).digest("hex"),
      encryptedDek: this.wrapDek(dek, organizationId, fileId, versionNumber),
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
  ): Buffer {
    if (
      objectBytes.length < OBJECT_MAGIC.length + NONCE_BYTES + TAG_BYTES ||
      !objectBytes.subarray(0, OBJECT_MAGIC.length).equals(OBJECT_MAGIC)
    ) {
      throw new InternalServerErrorException(
        "El objeto almacenado tiene un formato inválido",
      );
    }

    const nonceStart = OBJECT_MAGIC.length;
    const nonce = objectBytes.subarray(nonceStart, nonceStart + NONCE_BYTES);
    const tag = objectBytes.subarray(objectBytes.length - TAG_BYTES);
    const ciphertext = objectBytes.subarray(
      nonceStart + NONCE_BYTES,
      objectBytes.length - TAG_BYTES,
    );
    const dek = this.unwrapDek(
      encryptedDek,
      organizationId,
      fileId,
      versionNumber,
    );
    const decipher = createDecipheriv("aes-256-gcm", dek, nonce);
    decipher.setAAD(this.fileContext(organizationId, fileId, versionNumber));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const actualChecksum = createHash("sha256").update(plaintext).digest();
    const expected = Buffer.from(expectedChecksum, "hex");

    if (
      expected.length !== actualChecksum.length ||
      !timingSafeEqual(expected, actualChecksum)
    ) {
      throw new InternalServerErrorException(
        "No se pudo validar la integridad del archivo",
      );
    }
    return plaintext;
  }

  private encryptText(value: string, context: string): string {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey(), nonce);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return `v1.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
  }

  private wrapDek(
    dek: Buffer,
    organizationId: string,
    fileId: string,
    versionNumber: number,
  ): string {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.tenantKek(organizationId),
      nonce,
    );
    cipher.setAAD(this.dekContext(organizationId, fileId, versionNumber));
    const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
    return `v1.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
  }

  private unwrapDek(
    value: string,
    organizationId: string,
    fileId: string,
    versionNumber: number,
  ): Buffer {
    const [version, nonceText, tagText, ciphertextText] = value.split(".");
    if (version !== "v1" || !nonceText || !tagText || !ciphertextText) {
      throw new InternalServerErrorException(
        "La referencia cifrada del archivo no es válida",
      );
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.tenantKek(organizationId),
      Buffer.from(nonceText, "base64url"),
    );
    decipher.setAAD(this.dekContext(organizationId, fileId, versionNumber));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const dek = Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]);
    if (dek.length !== DEK_BYTES) {
      throw new InternalServerErrorException(
        "La llave del archivo no es válida",
      );
    }
    return dek;
  }

  private tenantKek(organizationId: string): Buffer {
    const masterKey = this.masterKey();
    return Buffer.from(
      hkdfSync(
        "sha256",
        masterKey,
        Buffer.from(organizationId),
        Buffer.from("nexus/files/tenant-kek/v1"),
        DEK_BYTES,
      ),
    );
  }

  private masterKey(): Buffer {
    const configured = this.config.get<string>("FILES_MASTER_KEY");
    if (!configured) {
      throw new InternalServerErrorException(
        "FILES_MASTER_KEY no está configurada",
      );
    }
    const key = Buffer.from(configured, "base64");
    if (key.length !== DEK_BYTES) {
      throw new InternalServerErrorException(
        "FILES_MASTER_KEY debe ser una llave base64 de 32 bytes",
      );
    }
    return key;
  }

  private fileContext(
    organizationId: string,
    fileId: string,
    versionNumber: number,
  ): Buffer {
    return Buffer.from(
      `nexus/files/content/v1/${organizationId}/${fileId}/${versionNumber}`,
    );
  }

  private dekContext(
    organizationId: string,
    fileId: string,
    versionNumber: number,
  ): Buffer {
    return Buffer.from(
      `nexus/files/dek/v1/${organizationId}/${fileId}/${versionNumber}`,
    );
  }
}
