import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Readable } from 'stream';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditEventInput, AuditResource } from '../audit/audit.types';
import { DriveAccessService } from './drive-access.service';
import { Drive } from './entities/drive.entity';
import { FileRecord } from './entities/file-record.entity';
import { FileVersion } from './entities/file-version.entity';
import { Folder } from './entities/folder.entity';
import { FileVersionsService } from './file-versions.service';
import { FilesCryptoService } from './files-crypto.service';
import { FilesService, UploadResult, versionAlreadyCurrentError } from './files.service';

const ORG = 'org-1';
const USER = 'user-1';
const ACTOR = { organizationId: ORG, userId: USER };
const DRIVE = { id: 'drive-1', organizationId: ORG, ownerUserId: USER, teamId: null, type: 'personal' };
const FOLDER = { id: 'folder-1', organizationId: ORG, driveId: 'drive-1', isDeleted: false };
const FILE = {
  id: 'file-1',
  organizationId: ORG,
  folderId: 'folder-1',
  name: 'informe.pdf',
  mimeType: 'application/pdf',
  isDeleted: false,
  currentVersionId: 'v3',
};

const PDF_V1 = Buffer.from('%PDF-1.4 contenido original de la version 1');
const PDF_V2 = Buffer.from('%PDF-1.4 contenido de la version 2, mas largo');
const PDF_V3 = Buffer.from('%PDF-1.4 contenido de la version 3, el vigente');

type VersionRow = Omit<FileVersion, 'fileRecord'>;

/** Clave de cifrado real: la misma configuración que files-crypto.service.spec.ts. */
const MASTER_KEY = randomBytes(32).toString('base64');
const crypto = new FilesCryptoService({ get: () => MASTER_KEY } as unknown as ConfigService);

const versionRow = (id: string, fileId: string, versionNumber: number, sizeBytes: number): VersionRow => ({
  id,
  fileId,
  versionNumber,
  destinationId: 'destination-1',
  objectKey: `${ORG}/${fileId}/v${versionNumber}/${id}`,
  sizeBytes: String(sizeBytes),
  checksum: '',
  encryptedDek: '',
  kekId: 'kek-1',
  formatVersion: 1,
  uploadedBy: USER,
  uploadedAt: new Date(Date.UTC(2026, 9, versionNumber, 12)),
});

/** Versión con contenido cifrado de verdad: el objeto guardado y los metadatos salen de FilesCryptoService. */
const storedVersion = (
  objects: Map<string, Buffer>,
  id: string,
  fileId: string,
  versionNumber: number,
  plaintext: Buffer,
): VersionRow => {
  const row = versionRow(id, fileId, versionNumber, plaintext.length);
  const encrypted = crypto.encryptFile(ORG, fileId, versionNumber, plaintext);
  objects.set(row.objectKey, encrypted.bytes);
  return { ...row, checksum: encrypted.checksum, encryptedDek: encrypted.encryptedDek };
};

const readAll = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

/** Devuelve el error de una promesa rechazada, o falla si la promesa se resuelve. */
const failureOf = async (promise: Promise<unknown>): Promise<HttpException> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('Se esperaba un error y la operación se resolvió');
};

const buildFixture = (overrides: { file?: Partial<typeof FILE>; folder?: Partial<typeof FOLDER> } = {}) => {
  const objects = new Map<string, Buffer>();
  const versions: VersionRow[] = [
    storedVersion(objects, 'v1', 'file-1', 1, PDF_V1),
    storedVersion(objects, 'v2', 'file-1', 2, PDF_V2),
    storedVersion(objects, 'v3', 'file-1', 3, PDF_V3),
    // Versión válida de otro archivo del mismo usuario: no debe ser accesible a través de file-1.
    storedVersion(objects, 'v-other', 'file-2', 1, Buffer.from('otro archivo')),
  ];
  const files = [{ ...FILE, ...overrides.file }];
  const folders = [{ ...FOLDER, ...overrides.folder }];

  const repositories = new Map<unknown, unknown>([
    [Drive, {
      findOne: jest.fn(({ where }: { where: { organizationId: string; ownerUserId: string } }) =>
        Promise.resolve(where.organizationId === ORG && where.ownerUserId === USER ? DRIVE : null),
      ),
    }],
    [FileRecord, {
      findOne: jest.fn(({ where }: { where: { id: string; organizationId: string } }) =>
        Promise.resolve(files.find((file) => file.id === where.id && file.organizationId === where.organizationId) ?? null),
      ),
    }],
    [Folder, {
      findOne: jest.fn(({ where }: { where: { id: string; organizationId: string } }) =>
        Promise.resolve(folders.find((folder) => folder.id === where.id && folder.organizationId === where.organizationId) ?? null),
      ),
    }],
  ]);
  const dataSource = { getRepository: jest.fn((entity: unknown) => repositories.get(entity)) };

  const versionRepository = {
    findOne: jest.fn(({ where }: { where: { id: string; fileId?: string } }) =>
      Promise.resolve(
        versions.find((version) => version.id === where.id && (where.fileId === undefined || version.fileId === where.fileId)) ?? null,
      ),
    ),
    save: jest.fn(),
    remove: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  };

  const storage = {
    get: jest.fn(async (objectKey: string) => {
      const bytes = objects.get(objectKey);
      if (!bytes) throw new Error('objeto ausente en el almacén de pruebas');
      return Readable.from([bytes]);
    }),
  };
  const storageRouter = { forRead: jest.fn(async () => storage), forWrite: jest.fn() };

  // Simula la carga real: la versión nueva aparece en la tabla antes de que el servicio la consulte.
  const uploadMultipartFileWithVersion = jest.fn<Promise<UploadResult>, [Parameters<FilesService['uploadMultipartFileWithVersion']>[0]]>(
    async () => {
      versions.push(versionRow('v4', 'file-1', 4, PDF_V1.length));
      return {
        id: 'file-1',
        name: 'informe.pdf',
        mimeType: 'application/pdf',
        sizeBytes: PDF_V1.length,
        versionId: 'v4',
        versionNumber: 4,
        uploadedAt: new Date('2026-11-05T10:00:00.000Z'),
      };
    },
  );
  const filesService = { uploadMultipartFileWithVersion } as unknown as FilesService;

  const logEvent = jest.fn<Promise<void>, [AuditEventInput]>().mockResolvedValue(undefined);
  const auditService = { logEvent } as unknown as AuditService;

  const service = new FileVersionsService(
    versionRepository as never,
    filesService,
    storageRouter as never,
    crypto,
    new DriveAccessService(dataSource as never),
    auditService,
  );

  return { service, objects, versions, versionRepository, storageRouter, storage, uploadMultipartFileWithVersion, logEvent };
};

describe('FileVersionsService (SPEC-210)', () => {
  describe('Escenario 1: descargar una versión anterior', () => {
    it('devuelve los bytes exactos de la versión 1 con el nombre del archivo', async () => {
      const { service, objects, storageRouter } = buildFixture();

      const result = await service.downloadVersion('file-1', 'v1', ACTOR);

      expect(await readAll(result.stream)).toEqual(PDF_V1);
      expect(result.name).toBe('informe.pdf');
      expect(result.mimeType).toBe('application/pdf');
      expect(storageRouter.forRead).toHaveBeenCalledWith(ORG, 'destination-1');
      // El almacén guarda el cifrado, nunca el texto claro.
      expect(objects.get(`${ORG}/file-1/v1/v1`)!.equals(PDF_V1)).toBe(false);
    });

    it('descifra la versión pedida aunque no sea la vigente (v2, con la vigente v3)', async () => {
      const { service } = buildFixture();

      const result = await service.downloadVersion('file-1', 'v2', ACTOR);

      expect(FILE.currentVersionId).toBe('v3');
      expect(await readAll(result.stream)).toEqual(PDF_V2);
    });

    it('readVersionBytes devuelve el texto claro con la firma fijada por SPEC-210', async () => {
      const { service, versions } = buildFixture();
      const version = versions.find((row) => row.id === 'v1') as FileVersion;

      const bytes = await service.readVersionBytes(ORG, FILE as unknown as FileRecord, version);

      expect(bytes.equals(PDF_V1)).toBe(true);
    });
  });

  describe('Escenario 2: restaurar crea una versión nueva', () => {
    it('reutiliza la carga con el contenido de la v1, el nombre y el tipo del archivo', async () => {
      const { service, uploadMultipartFileWithVersion } = buildFixture();

      await service.restoreVersion('file-1', 'v1', ACTOR);

      expect(uploadMultipartFileWithVersion).toHaveBeenCalledTimes(1);
      const input = uploadMultipartFileWithVersion.mock.calls[0][0];
      expect(input).toMatchObject({
        organizationId: ORG,
        ownerId: USER,
        folderId: 'folder-1',
        file: { originalname: 'informe.pdf', mimetype: 'application/pdf' },
      });
      expect(input.file.buffer.equals(PDF_V1)).toBe(true);
      expect(input.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('liga la carga al archivo por id y al contenido de la v1 (no busca por nombre)', async () => {
      const { service, uploadMultipartFileWithVersion, versions } = buildFixture();
      const v1 = versions.find((row) => row.id === 'v1') as FileVersion;

      await service.restoreVersion('file-1', 'v1', ACTOR);

      expect(uploadMultipartFileWithVersion.mock.calls[0][0].restore).toEqual({
        fileId: 'file-1',
        sourceVersionId: 'v1',
        sourceChecksum: v1.checksum,
      });
    });

    it('devuelve la versión nueva (versionNumber 4) y no borra las anteriores', async () => {
      const { service, versions, versionRepository } = buildFixture();

      const result = await service.restoreVersion('file-1', 'v1', ACTOR);

      expect(result).toEqual({
        fileId: 'file-1',
        versionId: 'v4',
        versionNumber: 4,
        sizeBytes: PDF_V1.length,
        uploadedAt: '2026-11-05T10:00:00.000Z',
      });
      expect(versions.map((row) => row.id)).toEqual(['v1', 'v2', 'v3', 'v-other', 'v4']);
      for (const method of ['save', 'remove', 'delete', 'update', 'softDelete'] as const) {
        expect(versionRepository[method]).not.toHaveBeenCalled();
      }
    });

    it('registra FILE_VERSION_RESTORED con el mismo correlationId que la carga', async () => {
      const { service, uploadMultipartFileWithVersion, logEvent } = buildFixture();

      await service.restoreVersion('file-1', 'v1', ACTOR);

      const correlationId = uploadMultipartFileWithVersion.mock.calls[0][0].correlationId;
      expect(logEvent).toHaveBeenCalledTimes(1);
      expect(logEvent).toHaveBeenCalledWith({
        organizationId: ORG,
        actorId: USER,
        action: AuditAction.FILE_VERSION_RESTORED,
        resourceType: AuditResource.FILE,
        resourceId: 'file-1',
        correlationId,
      });
    });

    it('no vuelve a leer la versión creada: el número sale de la carga', async () => {
      const { service, versionRepository } = buildFixture();

      await service.restoreVersion('file-1', 'v1', ACTOR);

      expect(versionRepository.findOne).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'v4' }) }));
    });

    it('devuelve el resultado aunque la auditoría falle', async () => {
      const { service, logEvent } = buildFixture();
      logEvent.mockRejectedValueOnce(new Error('Audit DB down'));

      const result = await service.restoreVersion('file-1', 'v1', ACTOR);

      expect(result.versionNumber).toBe(4);
    });
  });

  describe('Escenario 3: cuota', () => {
    it('propaga 422 STORAGE_QUOTA_EXCEEDED, no emite auditoría y no escribe filas', async () => {
      const { service, uploadMultipartFileWithVersion, logEvent, versionRepository, versions } = buildFixture();
      uploadMultipartFileWithVersion.mockRejectedValueOnce(new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          error: 'Unprocessable Entity',
          code: 'STORAGE_QUOTA_EXCEEDED',
          message: 'La carga excede la cuota disponible para el plan de la organización',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      ));

      const failure = await failureOf(service.restoreVersion('file-1', 'v1', ACTOR));

      expect(failure.getStatus()).toBe(422);
      expect(failure.getResponse()).toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' });
      expect(logEvent).not.toHaveBeenCalled();
      expect(versionRepository.save).not.toHaveBeenCalled();
      expect(versions).toHaveLength(4);
    });
  });

  describe('Carrera con la papelera y con otra restauración (revisión PR 52)', () => {
    it('si el archivo entra en papelera antes de la carga, responde 404 y no registra auditoría', async () => {
      const { service, uploadMultipartFileWithVersion, logEvent } = buildFixture();
      uploadMultipartFileWithVersion.mockRejectedValueOnce(new NotFoundException('Archivo file-1 no encontrado'));

      const failure = await failureOf(service.restoreVersion('file-1', 'v1', ACTOR));

      expect(failure.getStatus()).toBe(404);
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('si la vigente ya tiene el contenido restaurado, la carga responde 422 VERSION_ALREADY_CURRENT y no audita', async () => {
      const { service, uploadMultipartFileWithVersion, logEvent } = buildFixture();
      uploadMultipartFileWithVersion.mockRejectedValueOnce(versionAlreadyCurrentError());

      const failure = await failureOf(service.restoreVersion('file-1', 'v1', ACTOR));

      expect(failure.getStatus()).toBe(422);
      expect(failure.getResponse()).toMatchObject({ code: 'VERSION_ALREADY_CURRENT' });
      expect(logEvent).not.toHaveBeenCalled();
    });
  });

  describe('Escenario 4: versión ya vigente', () => {
    it('responde 422 VERSION_ALREADY_CURRENT sin leer el almacén ni cargar nada', async () => {
      const { service, uploadMultipartFileWithVersion, storageRouter, logEvent } = buildFixture();

      const failure = await failureOf(service.restoreVersion('file-1', 'v3', ACTOR));

      expect(failure.getStatus()).toBe(422);
      expect(failure.getResponse()).toMatchObject({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: 'VERSION_ALREADY_CURRENT',
        message: 'La versión indicada ya es la vigente',
      });
      expect(uploadMultipartFileWithVersion).not.toHaveBeenCalled();
      expect(storageRouter.forRead).not.toHaveBeenCalled();
      expect(logEvent).not.toHaveBeenCalled();
    });
  });

  describe('Escenario 5: versión de otro archivo o ajena responde 404', () => {
    it('versionId válido de otro archivo: 404 al descargar y al restaurar', async () => {
      const { service, uploadMultipartFileWithVersion, storageRouter } = buildFixture();

      await expect(service.downloadVersion('file-1', 'v-other', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.restoreVersion('file-1', 'v-other', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(storageRouter.forRead).not.toHaveBeenCalled();
      expect(uploadMultipartFileWithVersion).not.toHaveBeenCalled();
    });

    it('archivo de otro usuario del mismo organismo: 404', async () => {
      const { service, uploadMultipartFileWithVersion } = buildFixture();
      const otherUser = { organizationId: ORG, userId: 'user-2' };

      await expect(service.downloadVersion('file-1', 'v1', otherUser)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.restoreVersion('file-1', 'v1', otherUser)).rejects.toBeInstanceOf(NotFoundException);
      expect(uploadMultipartFileWithVersion).not.toHaveBeenCalled();
    });

    it('archivo de otra organización: 404 aunque el usuario exista', async () => {
      const { service, uploadMultipartFileWithVersion } = buildFixture();
      const otherOrg = { organizationId: 'org-2', userId: USER };

      await expect(service.downloadVersion('file-1', 'v1', otherOrg)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.restoreVersion('file-1', 'v1', otherOrg)).rejects.toBeInstanceOf(NotFoundException);
      expect(uploadMultipartFileWithVersion).not.toHaveBeenCalled();
    });

    it('mensaje 404 con el identificador del archivo, en español', async () => {
      const { service } = buildFixture();

      const failure = await failureOf(service.downloadVersion('file-1', 'v-other', ACTOR));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toMatchObject({ message: 'Archivo file-1 no encontrado' });
    });
  });

  describe('Escenario 6: archivo o carpeta en papelera responde 404', () => {
    it('archivo en papelera: 404 al descargar y al restaurar', async () => {
      const { service, uploadMultipartFileWithVersion } = buildFixture({ file: { isDeleted: true } });

      await expect(service.downloadVersion('file-1', 'v1', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.restoreVersion('file-1', 'v1', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(uploadMultipartFileWithVersion).not.toHaveBeenCalled();
    });

    it('carpeta en papelera: 404 al descargar y al restaurar', async () => {
      const { service, uploadMultipartFileWithVersion } = buildFixture({ folder: { isDeleted: true } });

      await expect(service.downloadVersion('file-1', 'v1', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.restoreVersion('file-1', 'v1', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(uploadMultipartFileWithVersion).not.toHaveBeenCalled();
    });
  });
});
