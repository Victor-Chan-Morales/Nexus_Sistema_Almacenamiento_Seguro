import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { FilesService } from './files.service';
import { FileRecord } from './entities/file-record.entity';
import { FileVersion } from './entities/file-version.entity';
import { Reservation } from './entities/reservation.entity';
import { Upload } from './entities/upload.entity';
import { FilesCryptoService } from './files-crypto.service';
import { DriveAccessService } from './drive-access.service';

/**
 * SPEC-210 (revisión PR 52): la carga en modo restaurar escribe en el archivo indicado, bloqueado por id,
 * y decide dentro de la transacción si la vigente ya tiene ese contenido. Se prueba con dobles de la
 * transacción; el bloqueo `FOR UPDATE` real necesita una prueba de integración contra PostgreSQL.
 */

const ORG = 'org-1';
const USER = 'user-1';
const FOLDER_ID = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '55555555-5555-4555-8555-555555555555';
const PDF = Buffer.from('%PDF-1.4 contenido restaurado');
const PDF_SHA = createHash('sha256').update(PDF).digest('hex');

const MASTER_KEY = randomBytes(32).toString('base64');
const crypto = new FilesCryptoService({ get: () => MASTER_KEY } as unknown as ConfigService);

interface Fixture {
  /** Fila del archivo tal como la devuelve la base; `null` simula papelera o archivo ajeno. */
  file: { id: string; name: string; mimeType: string; currentVersionId: string | null; isDeleted: boolean } | null;
  /** Checksum de la versión vigente; hace falta para la comprobación de contenido. */
  currentChecksum?: string;
}

const buildService = (fixture: Fixture) => {
  const findFileOptions: unknown[] = [];
  const fileRepo = {
    findOne: jest.fn(async (options: { where: Record<string, unknown> }) => {
      findFileOptions.push(options);
      // Filtra como la base: id, y isDeleted cuando la consulta lo pide.
      const matches = fixture.file
        && options.where.id === fixture.file.id
        && (options.where.isDeleted === undefined || options.where.isDeleted === fixture.file.isDeleted);
      return matches ? { ...fixture.file! } : null;
    }),
    create: jest.fn((row: unknown) => row),
    save: jest.fn(async (row: unknown) => row),
  };
  const versionRepo = {
    findOne: jest.fn(async (options: { where: Record<string, unknown> }) => {
      if (options.where.fileId !== undefined && options.where.id === undefined) {
        return { versionNumber: 3 }; // última versión del archivo
      }
      if (options.where.id === fixture.file?.currentVersionId) {
        return { id: options.where.id, checksum: fixture.currentChecksum ?? '' };
      }
      return null;
    }),
    create: jest.fn((row: unknown) => row),
    save: jest.fn(async (row: unknown) => ({ ...(row as object), id: 'v-new', uploadedAt: new Date('2026-11-05T10:00:00Z') })),
  };
  const repos = new Map<unknown, unknown>([
    [FileRecord, fileRepo],
    [FileVersion, versionRepo],
    [Reservation, {
      findOne: jest.fn(async () => ({ status: 'active' })),
      save: jest.fn(async (row: unknown) => row),
      create: jest.fn((row: unknown) => row),
    }],
    [Upload, {
      findOneBy: jest.fn(async () => ({})),
      save: jest.fn(async (row: unknown) => row),
      create: jest.fn(() => ({})),
    }],
  ]);
  const manager = {
    query: jest.fn(async () => []),
    getRepository: jest.fn((entity: unknown) => repos.get(entity)),
  };
  const dataSource = { transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)) };
  const storage = { put: jest.fn(async () => undefined) };
  const storageRouter = { forWrite: jest.fn(async () => storage), forRead: jest.fn(), defaultBucketName: 'nexus' };
  const driveAccess = new DriveAccessService({} as never);

  const service = new FilesService(
    {} as never, {} as never, {} as never,
    dataSource as never, storageRouter as never, {} as never, crypto, driveAccess,
    undefined, {} as never,
  );
  const internals = service as unknown as Record<string, jest.Mock | ((...args: unknown[]) => unknown)>;
  jest.spyOn(service, 'getOrCreateUserDrive').mockResolvedValue({ id: 'drive-1', name: 'Drive', rootFolderId: 'root-1' } as never);
  jest.spyOn(driveAccess, 'requireFolder').mockResolvedValue({
    folder: { id: FOLDER_ID, destinationId: null } as never,
    access: { drive: { id: 'drive-1' } as never, level: 'owner' },
  });
  jest.spyOn(internals as never, 'reserveUpload' as never).mockResolvedValue({ uploadId: 'up-1', reservationId: 'res-1' } as never);
  jest.spyOn(internals as never, 'ensureTenantResources' as never).mockResolvedValue({ destination: { id: 'dest-1' }, key: { id: 'kek-1' } } as never);
  jest.spyOn(internals as never, 'readStorageUsage' as never).mockResolvedValue({ usedBytes: 0n, reservedBytes: 0n, totalBytes: 0n } as never);
  jest.spyOn(internals as never, 'writeQuotaCounters' as never).mockResolvedValue(undefined as never);
  jest.spyOn(internals as never, 'lockTenantQuota' as never).mockResolvedValue(undefined as never);
  const finishFailedUpload = jest.spyOn(internals as never, 'finishFailedUpload' as never).mockResolvedValue(undefined as never);

  return { service, fileRepo, versionRepo, storage, dataSource, findFileOptions, finishFailedUpload };
};

const restoreInput = (sourceChecksum = PDF_SHA) => ({
  organizationId: ORG,
  ownerId: USER,
  folderId: FOLDER_ID,
  file: { buffer: PDF, originalname: 'informe.pdf', mimetype: 'application/pdf' },
  restore: { fileId: FILE_ID, sourceVersionId: 'v-old', sourceChecksum },
});

const activeFile = { id: FILE_ID, name: 'informe.pdf', mimeType: 'application/pdf', currentVersionId: 'v-cur', isDeleted: false };

describe('SPEC-210: carga en modo restaurar (FilesService.uploadMultipartFileWithVersion)', () => {
  it('bloquea el archivo por id y no lo busca por nombre', async () => {
    const { service, findFileOptions } = buildService({ file: activeFile, currentChecksum: 'otro' });

    await service.uploadMultipartFileWithVersion(restoreInput());

    const lookups = findFileOptions as Array<{ where: Record<string, unknown>; lock?: unknown }>;
    expect(lookups[0]).toMatchObject({
      where: { id: FILE_ID, organizationId: ORG, folderId: FOLDER_ID, isDeleted: false },
      lock: { mode: 'pessimistic_write' },
    });
    expect(lookups.some((options) => 'name' in options.where)).toBe(false);
  });

  it('crea la versión en el archivo indicado con número última + 1 y la devuelve', async () => {
    const { service, storage } = buildService({ file: activeFile, currentChecksum: 'otro' });

    const result = await service.uploadMultipartFileWithVersion(restoreInput());

    expect(result).toMatchObject({ id: FILE_ID, versionId: 'v-new', versionNumber: 4, sizeBytes: PDF.length });
    expect(storage.put).toHaveBeenCalledTimes(1);
  });

  it('archivo en papelera o ajeno: 404 sin escribir el objeto ni crear filas', async () => {
    const { service, storage, versionRepo } = buildService({ file: { ...activeFile, isDeleted: true } });

    const error = await service.uploadMultipartFileWithVersion(restoreInput()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(storage.put).not.toHaveBeenCalled();
    expect(versionRepo.save).not.toHaveBeenCalled();
  });

  it('si la vigente ya tiene el mismo contenido, responde 422 VERSION_ALREADY_CURRENT y no escribe nada', async () => {
    const { service, storage, versionRepo } = buildService({ file: activeFile, currentChecksum: PDF_SHA });

    const error = await service.uploadMultipartFileWithVersion(restoreInput()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(422);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'VERSION_ALREADY_CURRENT' });
    expect(storage.put).not.toHaveBeenCalled();
    expect(versionRepo.save).not.toHaveBeenCalled();
  });

  it('si la vigente es la misma versión indicada, también responde 422', async () => {
    const { service, storage } = buildService({ file: activeFile, currentChecksum: 'otro' });

    const error = await service
      .uploadMultipartFileWithVersion({ ...restoreInput(), restore: { fileId: FILE_ID, sourceVersionId: 'v-cur', sourceChecksum: 'otro' } })
      .catch((e: unknown) => e);

    expect((error as HttpException).getStatus()).toBe(422);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('una carga normal sigue buscando por nombre y creando el archivo si no existe', async () => {
    const { service, fileRepo } = buildService({ file: null });

    await service.uploadMultipartFileWithVersion({
      organizationId: ORG,
      ownerId: USER,
      folderId: FOLDER_ID,
      file: { buffer: PDF, originalname: 'nuevo.pdf', mimetype: 'application/pdf' },
    });

    expect(fileRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ name: 'nuevo.pdf', folderId: FOLDER_ID, isDeleted: false }),
    }));
    expect(fileRepo.create).toHaveBeenCalled();
  });
});

describe('SPEC-210: folderId debe ser un UUID antes de tocar la base', () => {
  it('folderId "None" responde 400 y no abre transacción ni reserva cuota', async () => {
    const { service, dataSource } = buildService({ file: null });

    const error = await service
      .uploadMultipartFile({
        organizationId: ORG,
        ownerId: USER,
        folderId: 'None',
        file: { buffer: PDF, originalname: 'informe.pdf', mimetype: 'application/pdf' },
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe('El parámetro folderId debe ser un UUID');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('folderId vacío mantiene el mensaje de siempre', async () => {
    const { service } = buildService({ file: null });

    const error = await service
      .uploadMultipartFile({
        organizationId: ORG,
        ownerId: USER,
        folderId: '',
        file: { buffer: PDF, originalname: 'informe.pdf', mimetype: 'application/pdf' },
      })
      .catch((e: unknown) => e);

    expect((error as BadRequestException).message).toBe('El parámetro folderId es obligatorio');
  });
});
