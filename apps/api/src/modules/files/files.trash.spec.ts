import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import { FilesService } from './files.service';
import { FileVersion } from './entities/file-version.entity';
import { FileRecord } from './entities/file-record.entity';
import { Folder } from './entities/folder.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';

const DAY_MS = 24 * 60 * 60 * 1000;
const DRIVE = { id: 'drive-1', name: 'Mi unidad', rootFolderId: 'root-1' };

/**
 * SPEC-202: listado de la papelera.
 *
 * Con dobles solo se puede verificar que la consulta aplica los filtros que garantizan el aislamiento
 * (organización, Drive del solicitante, `is_deleted = true`); la prueba contra PostgreSQL real queda
 * para integración.
 */
const buildQueryBuilder = (rows: unknown[], total: number) => {
  const qb: Record<string, jest.Mock> = {};
  for (const method of ['innerJoin', 'leftJoinAndMapOne', 'where', 'andWhere', 'orderBy', 'addOrderBy', 'take']) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getManyAndCount = jest.fn().mockResolvedValue([rows, total]);
  return qb;
};

const buildService = ({ drive = DRIVE, rows = [], total = rows.length }: { drive?: unknown; rows?: unknown[]; total?: number }) => {
  const qb = buildQueryBuilder(rows, total);
  const driveRepository = { findOne: jest.fn().mockResolvedValue(drive) };
  const dataSource = { getRepository: jest.fn().mockReturnValue(driveRepository), transaction: jest.fn() };
  const fileRepository = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
  const service = new FilesService(
    fileRepository as never,
    {} as never,
    {} as never,
    dataSource as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, qb, driveRepository, dataSource, fileRepository };
};

describe('FilesService.listTrash', () => {
  it('lista los archivos eliminados con tamaño numérico y retentionEndsAt = deletedAt + 30 días', async () => {
    const deletedAt = new Date('2026-10-01T10:00:00.000Z');
    const { service, qb } = buildService({
      rows: [
        { id: 'f1', name: 'a.pdf', mimeType: 'application/pdf', deletedAt, currentVersion: { id: 'v1', sizeBytes: '2048' } },
        { id: 'f2', name: 'b.bin', mimeType: null, deletedAt, currentVersion: null },
      ],
    });

    const result = await service.listTrash('org-1', 'user-1');

    expect(qb.leftJoinAndMapOne).toHaveBeenCalledWith(
      'file.currentVersion',
      FileVersion,
      'version',
      'version.id = file.currentVersionId',
    );
    expect(result.totalItems).toBe(2);
    expect(result.items).toEqual([
      {
        id: 'f1',
        name: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        deletedAt: deletedAt.toISOString(),
        retentionEndsAt: new Date(deletedAt.getTime() + 30 * DAY_MS).toISOString(),
      },
      expect.objectContaining({ id: 'f2', mimeType: 'application/octet-stream', sizeBytes: 0 }),
    ]);
  });

  it('acota la búsqueda del Drive al solicitante sin crearlo', async () => {
    const { service, driveRepository, dataSource } = buildService({ drive: null });

    await expect(service.listTrash('org-1', 'user-1')).resolves.toEqual({ items: [], totalItems: 0 });

    expect(dataSource.getRepository).toHaveBeenCalled();
    expect(driveRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1', ownerUserId: 'user-1', type: 'personal' }),
      }),
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('acota la consulta a la organización, al Drive del solicitante y a archivos eliminados', async () => {
    const { service, qb } = buildService({});

    await service.listTrash('org-1', 'user-1');

    expect(qb.where).toHaveBeenCalledWith('file.organizationId = :organizationId', { organizationId: 'org-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('folder.driveId = :driveId', { driveId: 'drive-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('file.isDeleted = :isDeleted', { isDeleted: true });
    expect(qb.andWhere).not.toHaveBeenCalledWith('file.isDeleted = :isDeleted', { isDeleted: false });
  });

  it('excluye filas sin deleted_at y ordena de forma estable con un máximo de 500', async () => {
    const { service, qb } = buildService({});

    await service.listTrash('org-1', 'user-1');

    expect(qb.andWhere).toHaveBeenCalledWith('file.deletedAt IS NOT NULL');
    expect(qb.orderBy).toHaveBeenCalledWith('file.deletedAt', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('file.id', 'ASC');
    expect(qb.take).toHaveBeenCalledWith(500);
  });

  it('devuelve totalItems real aunque haya más de 500 registros', async () => {
    const { service } = buildService({ rows: [], total: 501 });

    const result = await service.listTrash('org-1', 'user-1');

    expect(result.totalItems).toBe(501);
  });

  it('responde papelera vacía', async () => {
    const { service } = buildService({});

    await expect(service.listTrash('org-1', 'user-1')).resolves.toEqual({ items: [], totalItems: 0 });
  });
});

/**
 * SPEC-203: restaurar un archivo de la papelera.
 * El doble de EntityManager expone los repositorios de FileRecord y Folder; la transacción ejecuta el callback con él.
 */
const ORG = 'org-1';
const USER = 'user-1';
const FILE_ID = 'file-1';

const trashedFile = (overrides: Partial<FileRecord> = {}) =>
  Object.assign(new FileRecord(), {
    id: FILE_ID,
    organizationId: ORG,
    folderId: 'folder-1',
    name: 'contrato.pdf',
    isDeleted: true,
    deletedAt: new Date('2026-10-01T10:00:00.000Z'),
    ...overrides,
  });

const activeFolder = (overrides: Partial<Folder> = {}) =>
  Object.assign(new Folder(), { id: 'folder-1', organizationId: ORG, driveId: DRIVE.id, isDeleted: false, ...overrides });

const buildRestoreService = ({
  drive = DRIVE as unknown,
  file = trashedFile() as FileRecord | null,
  folder = activeFolder() as Folder | null,
  nameTaken = false,
  audit = { logEvent: jest.fn().mockResolvedValue(undefined) },
}: {
  drive?: unknown;
  file?: FileRecord | null;
  folder?: Folder | null;
  nameTaken?: boolean;
  audit?: { logEvent: jest.Mock };
} = {}) => {
  const driveRepo = { findOne: jest.fn().mockResolvedValue(drive) };
  const fileRepo = {
    findOne: jest.fn().mockResolvedValue(file),
    exists: jest.fn().mockResolvedValue(nameTaken),
    save: jest.fn(async (entity: FileRecord) => entity),
  };
  const folderRepo = { findOne: jest.fn().mockResolvedValue(folder) };
  const manager = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: jest.fn((entity: unknown) => (entity === FileRecord ? fileRepo : folderRepo)),
  };
  const dataSource = {
    getRepository: jest.fn().mockReturnValue(driveRepo),
    transaction: jest.fn((callback: (m: unknown) => Promise<unknown>) => callback(manager)),
  };
  const service = new FilesService(
    {} as never,
    {} as never,
    {} as never,
    dataSource as never,
    {} as never,
    {} as never,
    {} as never,
    audit as unknown as AuditService,
  );
  return { service, fileRepo, folderRepo, manager, audit };
};

/** Devuelve el error lanzado por una promesa rechazada, o falla si no hubo error. */
const errorOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('se esperaba un error');
};

describe('SPEC-203: FilesService.restoreFile', () => {
  it('escenario 1: devuelve el archivo a su carpeta, sin borrado lógico y con deleted_at nulo', async () => {
    const { service, fileRepo, audit } = buildRestoreService();

    const result = await service.restoreFile(FILE_ID, ORG, USER);

    expect(result).toEqual({ id: FILE_ID, name: 'contrato.pdf', folderId: 'folder-1' });
    expect(fileRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isDeleted: false, deletedAt: null }));
    expect(audit.logEvent).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: USER,
      action: AuditAction.FILE_RESTORE,
      resourceType: AuditResource.FILE,
      resourceId: FILE_ID,
    });
  });

  it('escenario 2: archivo inexistente, de otra organización o de otro Drive responde 404 sin cambios', async () => {
    const { service, fileRepo, audit } = buildRestoreService({ file: null });

    await expect(errorOf(service.restoreFile(FILE_ID, ORG, USER))).resolves.toBeInstanceOf(NotFoundException);
    expect(fileRepo.save).not.toHaveBeenCalled();
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('escenario 2: carpeta de otro Drive se trata como inexistente', async () => {
    const { service, fileRepo } = buildRestoreService({ folder: activeFolder({ driveId: 'drive-otro' }) });

    await expect(errorOf(service.restoreFile(FILE_ID, ORG, USER))).resolves.toBeInstanceOf(NotFoundException);
    expect(fileRepo.save).not.toHaveBeenCalled();
  });

  it('escenario 3: si ya hay un archivo activo con el mismo nombre responde 409 FILE_NAME_CONFLICT', async () => {
    const { service, fileRepo, audit } = buildRestoreService({ nameTaken: true });

    const error = await errorOf(service.restoreFile(FILE_ID, ORG, USER));

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(409);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'FILE_NAME_CONFLICT' });
    expect(fileRepo.save).not.toHaveBeenCalled();
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('escenario 4: si la carpeta original está en la papelera responde 409 PARENT_FOLDER_UNAVAILABLE', async () => {
    const { service, fileRepo } = buildRestoreService({ folder: activeFolder({ isDeleted: true }) });

    const error = await errorOf(service.restoreFile(FILE_ID, ORG, USER));

    expect((error as HttpException).getStatus()).toBe(409);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'PARENT_FOLDER_UNAVAILABLE' });
    expect(fileRepo.save).not.toHaveBeenCalled();
  });

  it('escenario 5: un archivo activo no se restaura y responde 404', async () => {
    const { service, fileRepo } = buildRestoreService({ file: trashedFile({ isDeleted: false, deletedAt: null }) });

    await expect(errorOf(service.restoreFile(FILE_ID, ORG, USER))).resolves.toBeInstanceOf(NotFoundException);
    expect(fileRepo.save).not.toHaveBeenCalled();
  });

  it('escenario 6: no modifica tenant_quota más allá del bloqueo de la transacción', async () => {
    const { service, manager } = buildRestoreService();

    await service.restoreFile(FILE_ID, ORG, USER);

    const quotaWrites = manager.query.mock.calls.filter(([sql]) => /UPDATE files\.tenant_quota/.test(String(sql)));
    expect(quotaWrites).toHaveLength(0);
  });

  it('bloquea la fila del archivo y serializa con la cuota de la organización', async () => {
    const { service, fileRepo, manager } = buildRestoreService();

    await service.restoreFile(FILE_ID, ORG, USER);

    expect(fileRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ lock: { mode: 'pessimistic_write' } }));
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), [ORG]);
  });

  it('no escribe nada ni lanza transacción si el solicitante no tiene Drive personal', async () => {
    const { service, manager, audit } = buildRestoreService({ drive: null });

    await expect(errorOf(service.restoreFile(FILE_ID, ORG, USER))).resolves.toBeInstanceOf(NotFoundException);
    expect(manager.query).not.toHaveBeenCalled();
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('un fallo de auditoría no cambia la respuesta de la restauración', async () => {
    const audit = { logEvent: jest.fn().mockRejectedValue(new Error('bitácora caída')) };
    const { service } = buildRestoreService({ audit });

    await expect(service.restoreFile(FILE_ID, ORG, USER)).resolves.toEqual({
      id: FILE_ID,
      name: 'contrato.pdf',
      folderId: 'folder-1',
    });
  });
});

/**
 * SPEC-204: purga definitiva.
 * Se comprueba el orden de borrado (FK RESTRICT), la cuota reescrita dentro de la transacción y que
 * los objetos de SeaweedFS se borran solo después del commit.
 */
const version = (versionNumber: number, sizeBytes: string) => ({
  id: `v${versionNumber}`,
  fileId: FILE_ID,
  versionNumber,
  sizeBytes,
  objectKey: `${ORG}/${FILE_ID}/v${versionNumber}/uuid`,
});

const buildPurgeService = ({
  file = trashedFile() as FileRecord | null,
  folder = activeFolder() as Folder | null,
  versions = [version(1, '10000000'), version(2, '8000000'), version(3, '5000000')],
  storageDelete = jest.fn().mockResolvedValue(undefined),
  transactionFails = false,
  audit = { logEvent: jest.fn().mockResolvedValue(undefined) },
}: {
  file?: FileRecord | null;
  folder?: Folder | null;
  versions?: ReturnType<typeof version>[];
  storageDelete?: jest.Mock;
  transactionFails?: boolean;
  audit?: { logEvent: jest.Mock };
} = {}) => {
  const driveRepo = { findOne: jest.fn().mockResolvedValue(DRIVE) };
  const fileRepo = {
    findOne: jest.fn().mockResolvedValue(file),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const folderRepo = { findOne: jest.fn().mockResolvedValue(folder) };
  const versionRepo = {
    find: jest.fn().mockResolvedValue(versions),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const manager = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === FileRecord) return fileRepo;
      if (entity === FileVersion) return versionRepo;
      return folderRepo;
    }),
  };
  const commit = { done: false };
  const dataSource = {
    getRepository: jest.fn().mockReturnValue(driveRepo),
    transaction: jest.fn(async (callback: (m: unknown) => Promise<unknown>) => {
      if (transactionFails) throw new Error('falla de base de datos');
      const result = await callback(manager);
      commit.done = true;
      return result;
    }),
  };
  const storage = {
    delete: jest.fn(async (key: string) => {
      if (!commit.done) throw new Error('se borró un objeto antes del commit: ' + key);
      return storageDelete(key);
    }),
  };
  const service = new FilesService(
    {} as never,
    {} as never,
    {} as never,
    dataSource as never,
    storage as never,
    {} as never,
    {} as never,
    audit as unknown as AuditService,
  );
  return { service, fileRepo, versionRepo, manager, storage, audit, dataSource };
};

describe('SPEC-204: FilesService.purgeFile', () => {
  it('escenario 1: purga las 3 versiones, libera 23 000 000 bytes y borra los objetos después del commit', async () => {
    const { service, fileRepo, versionRepo, storage } = buildPurgeService();

    const result = await service.purgeFile(FILE_ID, ORG, USER);

    expect(result).toEqual({ id: FILE_ID, freedBytes: 23_000_000 });
    expect(fileRepo.delete).toHaveBeenCalledWith({ id: FILE_ID });
    expect(versionRepo.delete).toHaveBeenCalledWith({ fileId: FILE_ID });
    expect(storage.delete.mock.calls.map(([key]) => key)).toEqual([
      `${ORG}/${FILE_ID}/v1/uuid`,
      `${ORG}/${FILE_ID}/v2/uuid`,
      `${ORG}/${FILE_ID}/v3/uuid`,
    ]);
  });

  it('respeta el orden de las FK RESTRICT: desvincula la versión vigente, borra versiones y después el archivo', async () => {
    const { service, fileRepo, versionRepo } = buildPurgeService();

    await service.purgeFile(FILE_ID, ORG, USER);

    const unlink = fileRepo.update.mock.invocationCallOrder[0];
    const deleteVersions = versionRepo.delete.mock.invocationCallOrder[0];
    const deleteFile = fileRepo.delete.mock.invocationCallOrder[0];
    expect(fileRepo.update).toHaveBeenCalledWith({ id: FILE_ID }, { currentVersionId: null });
    expect(unlink).toBeLessThan(deleteVersions);
    expect(deleteVersions).toBeLessThan(deleteFile);
  });

  it('reescribe los contadores de cuota dentro de la transacción', async () => {
    const { service, manager } = buildPurgeService();

    await service.purgeFile(FILE_ID, ORG, USER);

    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE files.tenant_quota'), expect.any(Array));
  });

  it('escenario 2: un archivo activo responde 422 CANNOT_PURGE_ACTIVE_FILE y no cambia nada', async () => {
    const { service, fileRepo, versionRepo, storage, audit } = buildPurgeService({
      file: trashedFile({ isDeleted: false, deletedAt: null }),
    });

    const error = await errorOf(service.purgeFile(FILE_ID, ORG, USER));

    expect((error as HttpException).getStatus()).toBe(422);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'CANNOT_PURGE_ACTIVE_FILE' });
    expect(fileRepo.delete).not.toHaveBeenCalled();
    expect(versionRepo.delete).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('escenario 3: archivo inexistente o de otro Drive responde 404', async () => {
    const { service, fileRepo } = buildPurgeService({ file: null });

    await expect(errorOf(service.purgeFile(FILE_ID, ORG, USER))).resolves.toBeInstanceOf(NotFoundException);
    expect(fileRepo.delete).not.toHaveBeenCalled();
  });

  it('escenario 4: si SeaweedFS falla al borrar, la purga sigue siendo exitosa y se registra la clave huérfana', async () => {
    const failing = `${ORG}/${FILE_ID}/v2/uuid`;
    const storageDelete = jest.fn(async (key: string) => {
      if (key === failing) throw new Error('S3 no responde');
    });
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service } = buildPurgeService({ storageDelete });

    await expect(service.purgeFile(FILE_ID, ORG, USER)).resolves.toEqual({ id: FILE_ID, freedBytes: 23_000_000 });

    expect(logError).toHaveBeenCalledWith('Objeto huérfano tras purga: ' + failing);
    logError.mockRestore();
  });

  it('escenario 5: si la transacción falla no se borra ningún objeto de SeaweedFS', async () => {
    const { service, storage, audit } = buildPurgeService({ transactionFails: true });

    await expect(service.purgeFile(FILE_ID, ORG, USER)).rejects.toThrow('falla de base de datos');
    expect(storage.delete).not.toHaveBeenCalled();
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('registra FILE_PURGE solo tras el commit exitoso', async () => {
    const { service, audit } = buildPurgeService();

    await service.purgeFile(FILE_ID, ORG, USER);

    expect(audit.logEvent).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: USER,
      action: AuditAction.FILE_PURGE,
      resourceType: AuditResource.FILE,
      resourceId: FILE_ID,
    });
  });

  it('un fallo de auditoría no cambia la respuesta de la purga', async () => {
    const audit = { logEvent: jest.fn().mockRejectedValue(new Error('bitácora caída')) };
    const { service } = buildPurgeService({ audit });

    await expect(service.purgeFile(FILE_ID, ORG, USER)).resolves.toEqual({ id: FILE_ID, freedBytes: 23_000_000 });
  });

  it('no busca ni borra nada si el solicitante no tiene Drive personal', async () => {
    const { service, dataSource, storage } = buildPurgeService();
    dataSource.getRepository.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });

    await expect(errorOf(service.purgeFile(FILE_ID, ORG, USER))).resolves.toBeInstanceOf(NotFoundException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });
});

