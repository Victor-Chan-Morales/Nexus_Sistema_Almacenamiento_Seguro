import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createHash, hkdfSync, randomBytes } from 'crypto';
import { FilesCryptoService } from './files-crypto.service';

const ORG = 'org-1';
const FILE = 'file-1';
const VERSION = 1;
const MAGIC_BYTES = 4;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const INVALID_FORMAT = 'El objeto almacenado tiene un formato inválido';
const INVALID_REFERENCE = 'La referencia cifrada del archivo no es válida';

const newMasterKey = () => randomBytes(32).toString('base64');

const serviceWith = (masterKey: string | undefined) =>
  new FilesCryptoService({ get: (name: string) => name === 'FILES_MASTER_KEY' ? masterKey : undefined } as ConfigService);

const flipByte = (source: Buffer, position: number) => {
  const copy = Buffer.from(source);
  copy[position] ^= 0xff;
  return copy;
};

/** Envuelve una DEK como lo hace el servicio, para probar valores que el servicio nunca produce. */
const wrapDekWith = (masterKey: string, dek: Buffer) => {
  const kek = Buffer.from(
    hkdfSync('sha256', Buffer.from(masterKey, 'base64'), Buffer.from(ORG), Buffer.from('nexus/files/tenant-kek/v1'), 32),
  );
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', kek, nonce);
  cipher.setAAD(Buffer.from(`nexus/files/dek/v1/${ORG}/${FILE}/${VERSION}`));
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
  return `v1.${nonce.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
};

describe('FilesCryptoService', () => {
  const masterKey = newMasterKey();
  const service = serviceWith(masterKey);
  const plaintext = Buffer.from('contenido confidencial de prueba');

  const encrypt = (content: Buffer = plaintext) => service.encryptFile(ORG, FILE, VERSION, content);

  describe('SPEC-005: llaves maestras versionadas', () => {
    const config = new ConfigService({
      FILES_MASTER_KEY: masterKey,
      FILES_MASTER_KEY_V2: newMasterKey(),
      FILES_MASTER_KEY_CURRENT_VERSION: '2',
    });
    const rotating = new FilesCryptoService(config);

    it('lee una DEK v1 por su referencia aunque la versión configurada sea v2', async () => {
      const encrypted = encrypt();
      const version = {
        fileId: FILE, versionNumber: VERSION, kekId: 'old-key',
        encryptedDek: encrypted.encryptedDek, checksum: encrypted.checksum,
      };
      const manager = { findOneBy: jest.fn().mockResolvedValue({ externalReference: service.externalKeyReference(ORG) }) };
      await expect(rotating.decryptStoredVersion(manager as never, ORG, version as never, encrypted.bytes)).resolves.toEqual(plaintext);
      expect(manager.findOneBy).toHaveBeenCalledWith(expect.anything(), { id: 'old-key', organizationId: ORG });
    });

    it('reenvuelve solo la DEK y conserva los bytes y el checksum del objeto', () => {
      const encrypted = encrypt();
      const rewrapped = rotating.rewrapDek(ORG, FILE, VERSION, encrypted.encryptedDek, 1, 2);
      expect(rewrapped).not.toBe(encrypted.encryptedDek);
      expect(rotating.decryptFile(ORG, FILE, VERSION, rewrapped, encrypted.checksum, encrypted.bytes, 2)).toEqual(plaintext);
      expect(() => rotating.decryptFile(ORG, FILE, VERSION, rewrapped, encrypted.checksum, encrypted.bytes, 1)).toThrow();
    });

    it('usa la versión configurada para una carga nueva y conserva el contexto de destinos', () => {
      const encrypted = rotating.encryptFile(ORG, FILE, VERSION, plaintext);
      expect(rotating.decryptFile(ORG, FILE, VERSION, encrypted.encryptedDek, encrypted.checksum, encrypted.bytes, 2)).toEqual(plaintext);
      expect(rotating.keyVersionFromReference(rotating.externalKeyReference(ORG), ORG)).toBe(2);
      const legacy = service.encryptConnectionDetails(ORG, 'datos de prueba');
      const next = rotating.encryptConnectionDetails(ORG, rotating.decryptConnectionDetails(ORG, legacy));
      expect(next.startsWith('k2.')).toBe(true);
      expect(rotating.decryptConnectionDetails(ORG, next)).toBe('datos de prueba');
      expect(() => rotating.decryptConnectionDetails('otra-organización', next)).toThrow();
    });
  });

  describe('Escenario 1: ida y vuelta', () => {
    it.each([
      ['texto', plaintext],
      ['vacío (0 bytes)', Buffer.alloc(0)],
      ['binario de 1 MB', randomBytes(1024 * 1024)],
    ])('recupera el mismo contenido: %s', (_name, content) => {
      const encrypted = encrypt(content);

      const decrypted = service.decryptFile(ORG, FILE, VERSION, encrypted.encryptedDek, encrypted.checksum, encrypted.bytes);

      expect(decrypted.equals(content)).toBe(true);
    });

    it('produce un objeto con formato NXF1 que no contiene el texto original', () => {
      const encrypted = encrypt();

      expect(encrypted.formatVersion).toBe(1);
      expect(encrypted.bytes.subarray(0, MAGIC_BYTES).toString('ascii')).toBe('NXF1');
      expect(encrypted.bytes.includes(plaintext)).toBe(false);
      expect(encrypted.checksum).toBe(createHash('sha256').update(plaintext).digest('hex'));
    });
  });

  describe('Escenario 2: objeto alterado', () => {
    const encrypted = encrypt();
    const lastByte = encrypted.bytes.length - 1;

    it.each([
      ['nonce', MAGIC_BYTES],
      ['texto cifrado', MAGIC_BYTES + NONCE_BYTES],
      ['etiqueta', lastByte - TAG_BYTES + 1],
      ['último byte de la etiqueta', lastByte],
    ])('rechaza un byte cambiado en: %s', (_name, position) => {
      const tampered = flipByte(encrypted.bytes, position);

      expect(() =>
        service.decryptFile(ORG, FILE, VERSION, encrypted.encryptedDek, encrypted.checksum, tampered),
      ).toThrow();
    });

    it('rechaza una DEK cifrada alterada', () => {
      const parts = encrypted.encryptedDek.split('.');
      const ciphertext = flipByte(Buffer.from(parts[3], 'base64url'), 0).toString('base64url');
      const tamperedDek = [parts[0], parts[1], parts[2], ciphertext].join('.');

      expect(() =>
        service.decryptFile(ORG, FILE, VERSION, tamperedDek, encrypted.checksum, encrypted.bytes),
      ).toThrow();
    });
  });

  describe('Escenario 3: contexto cruzado', () => {
    const encrypted = encrypt();

    it.each([
      ['otra organización', 'org-2', FILE, VERSION],
      ['otro archivo', ORG, 'file-2', VERSION],
      ['otra versión', ORG, FILE, 2],
    ])('rechaza descifrar con %s', (_name, organizationId, fileId, versionNumber) => {
      expect(() =>
        service.decryptFile(organizationId, fileId, versionNumber, encrypted.encryptedDek, encrypted.checksum, encrypted.bytes),
      ).toThrow();
    });

    it('rechaza descifrar con otra llave maestra', () => {
      const other = serviceWith(newMasterKey());

      expect(() =>
        other.decryptFile(ORG, FILE, VERSION, encrypted.encryptedDek, encrypted.checksum, encrypted.bytes),
      ).toThrow();
    });

    describe('con la DEK correcta', () => {
      const dek = randomBytes(32);
      const encryptedDek = wrapDekWith(masterKey, dek);
      const checksum = createHash('sha256').update(plaintext).digest('hex');
      const objectWithContext = (context: string) => {
        const nonce = randomBytes(NONCE_BYTES);
        const cipher = createCipheriv('aes-256-gcm', dek, nonce);
        cipher.setAAD(Buffer.from(context));
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return Buffer.concat([Buffer.from('NXF1', 'ascii'), nonce, ciphertext, cipher.getAuthTag()]);
      };

      it('acepta un objeto cifrado con el contexto de este archivo', () => {
        const bytes = objectWithContext(`nexus/files/content/v1/${ORG}/${FILE}/${VERSION}`);

        expect(service.decryptFile(ORG, FILE, VERSION, encryptedDek, checksum, bytes).equals(plaintext)).toBe(true);
      });

      it.each([
        ['otra organización', `nexus/files/content/v1/org-2/${FILE}/${VERSION}`],
        ['otro archivo', `nexus/files/content/v1/${ORG}/file-2/${VERSION}`],
        ['otra versión', `nexus/files/content/v1/${ORG}/${FILE}/2`],
      ])('rechaza un objeto cifrado con el contexto de %s', (_name, context) => {
        const bytes = objectWithContext(context);

        expect(() => service.decryptFile(ORG, FILE, VERSION, encryptedDek, checksum, bytes)).toThrow();
      });
    });
  });

  describe('Escenario 4: llaves distintas', () => {
    it('cambia la DEK cifrada y el nonce al cifrar dos veces el mismo contenido', () => {
      const first = encrypt();
      const second = encrypt();
      const nonceOf = (bytes: Buffer) => bytes.subarray(MAGIC_BYTES, MAGIC_BYTES + NONCE_BYTES);

      expect(first.encryptedDek).not.toBe(second.encryptedDek);
      expect(nonceOf(first.bytes).equals(nonceOf(second.bytes))).toBe(false);
      expect(first.bytes.equals(second.bytes)).toBe(false);
      expect(first.checksum).toBe(second.checksum);
    });
  });

  describe('Escenario 5: checksum incorrecto', () => {
    const integrityError = 'No se pudo validar la integridad del archivo';
    const encrypted = encrypt();

    it.each([
      ['de otro contenido', createHash('sha256').update('otro contenido').digest('hex')],
      ['de longitud distinta', 'abcd'],
      ['vacío', ''],
    ])('rechaza un checksum %s', (_name, checksum) => {
      const decrypt = () => service.decryptFile(ORG, FILE, VERSION, encrypted.encryptedDek, checksum, encrypted.bytes);

      expect(decrypt).toThrow(InternalServerErrorException);
      expect(decrypt).toThrow(integrityError);
    });
  });

  describe('Escenario 6: llave maestra inválida', () => {
    const encrypted = encrypt();

    it.each([
      ['ausente', undefined, 'FILES_MASTER_KEY no está configurada'],
      ['vacía', '', 'FILES_MASTER_KEY no está configurada'],
      ['de 16 bytes', randomBytes(16).toString('base64'), 'FILES_MASTER_KEY debe ser una llave base64 de 32 bytes'],
      ['de 33 bytes', randomBytes(33).toString('base64'), 'FILES_MASTER_KEY debe ser una llave base64 de 32 bytes'],
    ])('falla al cifrar y al descifrar: %s', (_name, invalidKey, message) => {
      const invalid = serviceWith(invalidKey);

      expect(() => invalid.encryptFile(ORG, FILE, VERSION, plaintext)).toThrow(message);
      expect(() =>
        invalid.decryptFile(ORG, FILE, VERSION, encrypted.encryptedDek, encrypted.checksum, encrypted.bytes),
      ).toThrow(message);
    });
  });

  describe('Escenario 7: formato inválido', () => {
    const encrypted = encrypt();

    it.each([
      ['sin el prefijo NXF1', flipByte(encrypted.bytes, 0)],
      ['vacío', Buffer.alloc(0)],
      ['más corto que el mínimo', encrypted.bytes.subarray(0, MAGIC_BYTES + NONCE_BYTES + TAG_BYTES - 1)],
    ])('rechaza un objeto %s', (_name, bytes) => {
      const decrypt = () => service.decryptFile(ORG, FILE, VERSION, encrypted.encryptedDek, encrypted.checksum, bytes);

      expect(decrypt).toThrow(InternalServerErrorException);
      expect(decrypt).toThrow(INVALID_FORMAT);
    });

    it.each([
      ['otra versión de formato', 'v2.a.b.c'],
      ['partes incompletas', 'v1.a.b'],
      ['texto vacío', ''],
    ])('rechaza una DEK cifrada con %s', (_name, encryptedDek) => {
      expect(() =>
        service.decryptFile(ORG, FILE, VERSION, encryptedDek, encrypted.checksum, encrypted.bytes),
      ).toThrow(INVALID_REFERENCE);
    });

    it('rechaza una DEK descifrada que no mide 32 bytes', () => {
      const shortDek = wrapDekWith(masterKey, randomBytes(16));

      expect(() =>
        service.decryptFile(ORG, FILE, VERSION, shortDek, encrypted.checksum, encrypted.bytes),
      ).toThrow('La llave del archivo no es válida');
    });
  });

  describe('referencias y datos de conexión', () => {
    it('la referencia externa de la llave no contiene material secreto', () => {
      const reference = service.externalKeyReference(ORG);

      expect(reference).toBe(`hkdf-sha256://env/FILES_MASTER_KEY/${ORG}/v1`);
      expect(reference).not.toContain(masterKey);
    });

    it('cifra los datos de conexión sin exponerlos y con un nonce distinto cada vez', () => {
      const secret = 'secret-key-de-prueba';
      const first = service.encryptConnectionDetails(ORG, secret);
      const second = service.encryptConnectionDetails(ORG, secret);

      expect(first).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(first).not.toContain(secret);
      expect(first).not.toBe(second);
    });

    it('descifra los datos de conexión de la misma organización', () => {
      const secret = JSON.stringify({ accessKey: 'AK-prueba', secretKey: 'SK-prueba' });
      const encrypted = service.encryptConnectionDetails(ORG, secret);

      expect(service.decryptConnectionDetails(ORG, encrypted)).toBe(secret);
    });

    it('no descifra datos de conexión de otra organización', () => {
      const encrypted = service.encryptConnectionDetails(ORG, 'secret-key-de-prueba');

      expect(() => service.decryptConnectionDetails('org-2', encrypted)).toThrow(
        new InternalServerErrorException('No se pudieron descifrar los datos de conexión'),
      );
    });

    it('rechaza datos de conexión alterados sin revelar el motivo', () => {
      const encrypted = service.encryptConnectionDetails(ORG, 'secret-key-de-prueba');
      const [version, nonce, tag, ciphertext] = encrypted.split('.');
      const altered = flipByte(Buffer.from(ciphertext, 'base64url'), 0).toString('base64url');

      expect(() => service.decryptConnectionDetails(ORG, [version, nonce, tag, altered].join('.'))).toThrow(
        new InternalServerErrorException('No se pudieron descifrar los datos de conexión'),
      );
    });

    it('rechaza un valor con formato distinto de v1', () => {
      expect(() => service.decryptConnectionDetails(ORG, 'environment:S3_BUCKET')).toThrow(
        new InternalServerErrorException('No se pudieron descifrar los datos de conexión'),
      );
    });
  });
});
