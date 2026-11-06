import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { FilesService } from './files.service';
import { Drive } from './entities/drive.entity';
import { Folder } from './entities/folder.entity';
import { Destination } from './entities/destination.entity';
import { FileRecord } from './entities/file-record.entity';
import { FileVersion } from './entities/file-version.entity';
import { Reservation } from './entities/reservation.entity';
import { TenantEncryptionKey } from './entities/tenant-encryption-key.entity';
import { TenantQuota } from './entities/tenant-quota.entity';
import { Upload } from './entities/upload.entity';
import { DriveAccessService } from './drive-access.service';

const GB = 1_000_000_000;

/**
 * Cuota y reservas de carga (CONTRACTS.md): una carga considera `usedBytes + reservedBytes`.
 *
 * Tras la integración al esquema canónico las reservas dejaron de vivir en memoria y pasaron a
 * `files.reservation`, con el conteo serializado por un bloqueo sobre `files.tenant_quota`.
 * Aquí quedan las dos reglas que todavía se pueden verificar con dobles: la aritmética de cuota
 * y el rechazo 422 antes de escribir el objeto. El ciclo de vida completo de la reserva
 * (liberación al fallar el almacenamiento y dos cargas simultáneas contándose entre sí) depende
 * de `SELECT ... FOR UPDATE` y necesita una prueba de integración contra PostgreSQL.
 */
const buildManager = (options: { usedBytes: number; reservedBytes: number }) => ({
  query: jest.fn(async (sql: string) => {
    if (sql.includes('SUM(version.size_bytes)')) {
      return [{ total: String(options.usedBytes), usedBytes: String(options.usedBytes) }];
    }
    if (sql.includes('FROM files.reservation')) {
      return [{ total: String(options.reservedBytes) }];
    }
    return [];
  }),
  getRepository: jest.fn(),
});

describe('FilesService — cuota y reservas de carga', () => {
  it('getTotalStorageUsage suma uso confirmado y reservas activas bajo el bloqueo de cuota', async () => {
    const manager = buildManager({ usedBytes: 2 * GB, reservedBytes: 1 * GB });
    const service = new FilesService(
      {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never,
    );

    const usage = await service.getTotalStorageUsage('org-1', manager as never);

    expect(usage.usedBytes).toBe(BigInt(2 * GB));
    expect(usage.reservedBytes).toBe(BigInt(1 * GB));
    expect(usage.totalBytes).toBe(BigInt(3 * GB));
    // El coordinador de Billing valida downgrades con este total: el conteo debe serializarse.
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), ['org-1']);
  });

  it('rechaza con 422 STORAGE_QUOTA_EXCEEDED y no escribe el objeto si la carga no cabe', async () => {
    // Límite 100 bytes, 90 ya comprometidos entre uso confirmado y reservas activas.
    const manager = buildManager({ usedBytes: 80, reservedBytes: 10 });
    manager.getRepository.mockReturnValue({
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      save: jest.fn(),
    });
    const dataSource = { transaction: jest.fn(async (cb: any) => cb(manager)) };
    const storageRouter = { forWrite: jest.fn(), forRead: jest.fn(), defaultBucketName: 'nexus' };
    const billingService = { getStorageLimitBytes: jest.fn().mockResolvedValue(BigInt(100)) };

    const driveAccess = new DriveAccessService({} as never);
    const service = new FilesService(
      {} as never, {} as never, {} as never,
      dataSource as never, storageRouter as never, billingService as never, {} as never, driveAccess,
    );
    jest.spyOn(service, 'getOrCreateUserDrive').mockResolvedValue({
      id: 'drive-1',
      name: 'Mi unidad',
      rootFolderId: 'folder-root',
    });
    jest.spyOn(driveAccess, 'requireFolder')
      .mockResolvedValue({ folder: { id: '11111111-1111-4111-8111-111111111111' } as never, access: { drive: { id: 'drive-1' } as never, level: 'owner' } });

    const buffer = Buffer.from('%PDF-1.4 contenido de prueba'); // 28 bytes: 90 + 28 > 100
    const error = await service
      .uploadMultipartFile({
        organizationId: 'org-1',
        ownerId: 'user-1',
        folderId: '11111111-1111-4111-8111-111111111111',
        file: { originalname: 'informe.pdf', mimetype: 'application/pdf', buffer },
      })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'STORAGE_QUOTA_EXCEEDED',
    });
    expect(storageRouter.forWrite).not.toHaveBeenCalled();
  });
});

describe('SPEC-801: compensación de una carga en el destino donde se escribió', () => {
  const DEFAULT_DESTINATION = 'dest-a';
  const FOLDER_DESTINATION = 'dest-b';

  const buildUploadService = () => {
    const rows = (value: unknown) => ({
      findOne: jest.fn().mockResolvedValue(value),
      findOneBy: jest.fn().mockResolvedValue(value),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data: object) => ({ ...data })),
      save: jest.fn(async (data: object) => ({ id: 'saved-id', ...data })),
      update: jest.fn(),
      delete: jest.fn(),
    });
    const repos = new Map<unknown, ReturnType<typeof rows>>([
      [Destination, rows({ id: DEFAULT_DESTINATION, organizationId: 'org-1', isEnabled: true, isDefault: true })],
      [TenantEncryptionKey, rows({ id: 'key-1' })],
      [TenantQuota, rows({ organizationId: 'org-1' })],
      [Reservation, rows({ id: 'res-1', status: 'active' })],
      [Upload, rows(null)],
      [FileRecord, rows(null)],
      [FileVersion, rows(null)],
    ]);
    repos.get(Upload)!.findOneBy.mockResolvedValue({ id: 'saved-id', organizationId: 'org-1', status: 'Pendiente' });
    // Fallo de base de datos después de que el objeto ya está en el almacén.
    repos.get(FileVersion)!.save.mockRejectedValue(new Error('conexión perdida'));
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: unknown) => repos.get(entity)),
    };
    const dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => cb(manager)),
    };
    const storage = { put: jest.fn().mockResolvedValue(undefined) };
    const cleanup = { delete: jest.fn().mockResolvedValue(undefined) };
    const storageRouter = {
      forWrite: jest.fn().mockResolvedValue(storage),
      forRead: jest.fn().mockResolvedValue(cleanup),
      defaultBucketName: 'nexus',
    };
    const crypto = {
      encryptFile: jest.fn().mockReturnValue({
        bytes: Buffer.from('cifrado'),
        checksum: 'sum',
        encryptedDek: 'dek',
        formatVersion: 1,
      }),
    };
    const billingService = { getStorageLimitBytes: jest.fn().mockResolvedValue(BigInt(1_000_000)) };
    const driveAccess = new DriveAccessService({} as never);
    const service = new FilesService(
      {} as never, {} as never, {} as never,
      dataSource as never, storageRouter as never, billingService as never, crypto as never, driveAccess,
    );
    jest.spyOn(service, 'getOrCreateUserDrive').mockResolvedValue({
      id: 'drive-1',
      name: 'Mi unidad',
      rootFolderId: 'folder-root',
    });
    jest.spyOn(driveAccess, 'requireFolder').mockResolvedValue({
      folder: { id: '11111111-1111-4111-8111-111111111111', destinationId: FOLDER_DESTINATION } as never,
      access: { drive: { id: 'drive-1' } as never, level: 'owner' },
    });
    return { service, storageRouter, storage, cleanup, repos };
  };

  it('si la versión no se puede guardar tras escribir el objeto, lo borra en el destino de la carpeta', async () => {
    const { service, storageRouter, storage, cleanup, repos } = buildUploadService();

    await expect(service.uploadMultipartFile({
      organizationId: 'org-1',
      ownerId: 'user-1',
      folderId: '11111111-1111-4111-8111-111111111111',
      file: { originalname: 'informe.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
    })).rejects.toThrow('No se pudo completar la carga del archivo');

    const writtenKey = storage.put.mock.calls[0][0];
    expect(storageRouter.forWrite).toHaveBeenCalledWith('org-1', FOLDER_DESTINATION);
    expect(storageRouter.forRead).toHaveBeenCalledWith('org-1', FOLDER_DESTINATION);
    expect(storageRouter.forRead).not.toHaveBeenCalledWith('org-1', DEFAULT_DESTINATION);
    expect(cleanup.delete).toHaveBeenCalledWith(writtenKey);

    const uploadSaves = repos.get(Upload)!.save.mock.calls.map(([data]) => data as Record<string, unknown>);
    expect(uploadSaves.at(-1)).toMatchObject({
      status: 'Fallida',
      destinationId: FOLDER_DESTINATION,
      objectKey: writtenKey,
    });
  });
});

describe('SPEC-801: almacén por destino de la versión', () => {
  const buildDownloadService = (destinationId: string) => {
    const qb: Record<string, unknown> = {};
    for (const method of ['innerJoin', 'where', 'andWhere']) qb[method] = jest.fn(() => qb);
    qb.getOne = jest.fn().mockResolvedValue({
      id: 'file-1',
      name: 'informe.pdf',
      mimeType: 'application/pdf',
      currentVersionId: 'v-1',
    });
    const fileRepository = { createQueryBuilder: jest.fn(() => qb) };
    const versionRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'v-1',
        fileId: 'file-1',
        versionNumber: 1,
        destinationId,
        objectKey: 'org-1/file-1/v1/uuid',
        encryptedDek: 'dek',
        checksum: 'sum',
      }),
    };
    const storage = {
      get: jest.fn().mockResolvedValue(Readable.from([Buffer.from('cifrado')])),
    };
    const storageRouter = { forRead: jest.fn().mockResolvedValue(storage), forWrite: jest.fn() };
    const crypto = { decryptFile: jest.fn().mockReturnValue(Buffer.from('texto plano')) };
    const driveAccess = new DriveAccessService({} as never);
    jest.spyOn(driveAccess, 'findDrive').mockResolvedValue({
      drive: { id: 'drive-1' } as never,
      level: 'owner',
    });
    const service = new FilesService(
      fileRepository as never, {} as never, versionRepository as never,
      {} as never, storageRouter as never, {} as never, crypto as never, driveAccess,
    );
    return { service, storageRouter, storage };
  };

  it.each(['dest-a', 'dest-b'])(
    'escenario 2: la versión se lee con el proveedor de su destination_id (%s)',
    async (destinationId) => {
      const { service, storageRouter, storage } = buildDownloadService(destinationId);

      const download = await service.downloadFileStream('file-1', 'org-1', 'user-1');

      expect(storageRouter.forRead).toHaveBeenCalledWith('org-1', destinationId);
      expect(storage.get).toHaveBeenCalledWith('org-1/file-1/v1/uuid');
      expect(download.name).toBe('informe.pdf');
    },
  );
});

/**
 * Tamaño de carpetas (CONTRACTS.md): suma de la versión actual de los archivos activos de la
 * carpeta y de todas sus subcarpetas. La recursión vive en una CTE de PostgreSQL, así que aquí
 * se verifica el contrato del servicio con la fila que devuelve esa consulta; el recorrido real
 * del árbol necesita una prueba de integración contra PostgreSQL.
 */
describe('FilesService — tamaño de carpetas', () => {
  const folderEntity = (id: string, parentId: string | null) => ({
    id,
    name: id,
    parentId,
    driveId: 'drive-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  });

  const buildService = (sizeRows: Array<{ folderId: string; totalSizeBytes: string }>) => {
    const dataSource = { query: jest.fn().mockResolvedValue(sizeRows) };
    const folderRepository = {
      find: jest.fn().mockResolvedValue([folderEntity('hija-a', 'raiz'), folderEntity('hija-b', 'raiz')]),
    };
    const fileRepository = { find: jest.fn().mockResolvedValue([]) };
    const driveAccess = new DriveAccessService({} as never);
    const service = new FilesService(
      fileRepository as never, folderRepository as never, {} as never,
      dataSource as never, {} as never, {} as never, {} as never, driveAccess,
    );
    jest.spyOn(service, 'getOrCreateUserDrive').mockResolvedValue({
      id: 'drive-1', name: 'Mi unidad', rootFolderId: 'raiz',
    });
    jest.spyOn(driveAccess, 'requireFolder')
      .mockResolvedValue({ folder: folderEntity('raiz', null) as never, access: { drive: { id: 'drive-1' } as never, level: 'owner' } });
    return { service, dataSource };
  };

  it('getFolderItems expone el tamaño anidado como número y 0 para carpetas sin archivos', async () => {
    // raiz agrega las subcarpetas (700 + 0) más sus propios archivos (300); hija-b está vacía.
    const { service, dataSource } = buildService([
      { folderId: 'raiz', totalSizeBytes: '1000' },
      { folderId: 'hija-a', totalSizeBytes: '700' },
    ]);

    const result = await service.getFolderItems('org-1', 'user-1', 'raiz');

    expect(result.folder.sizeBytes).toBe(1000);
    expect(result.folders.map((f) => [f.id, f.sizeBytes])).toEqual([
      ['hija-a', 700],
      ['hija-b', 0],
    ]);
    expect(typeof result.folder.sizeBytes).toBe('number');
    // Una sola consulta para la carpeta y sus hijas, acotada a la organización.
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('WITH RECURSIVE'),
      ['org-1', ['raiz', 'hija-a', 'hija-b']],
    );
  });

  it('listFolders incluye createdAt y sizeBytes de cada carpeta', async () => {
    const { service } = buildService([{ folderId: 'hija-a', totalSizeBytes: '2500' }]);

    const result = await service.listFolders('org-1', 'user-1', 'raiz');

    expect(result.items).toEqual([
      expect.objectContaining({ id: 'hija-a', sizeBytes: 2500, createdAt: new Date('2026-01-01T00:00:00Z') }),
      expect.objectContaining({ id: 'hija-b', sizeBytes: 0 }),
    ]);
  });

  it('la consulta solo cuenta carpetas y archivos activos y no cae en ciclos', async () => {
    const { service, dataSource } = buildService([]);
    await service.listFolders('org-1', 'user-1', 'raiz');

    const sql = dataSource.query.mock.calls[0][0] as string;
    expect(sql).toContain('f.is_deleted = false');
    expect(sql).toContain('current_version_id');
    // UNION (sin ALL) descarta pares repetidos y evita la recursión infinita ante un ciclo.
    expect(sql).not.toContain('UNION ALL');
  });
});

/**
 * SPEC-221, sección 10 (escenario 3 por operación): un Drive ajeno responde 404 en cada operación y
 * no se escribe nada. Los repositorios filtran por los campos del `where`, como la consulta real: si
 * el servicio olvida el `driveId` del solicitante, la carpeta ajena se encuentra y la prueba falla.
 */
const SPEC221_ORG = 'org-1';
const SPEC221_USER = 'user-1';

const fakeRepo = <T extends Record<string, unknown>>(rows: T[]) => ({
  findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
    rows.find((row) => Object.entries(where).every(([key, value]) =>
      (value !== null && typeof value === 'object') || row[key] === value)) ?? null),
  find: jest.fn(async () => []),
  exists: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
  update: jest.fn(),
});

const buildForeignDriveService = () => {
  const ownDrive = {
    id: 'drive-1', organizationId: SPEC221_ORG, ownerUserId: SPEC221_USER, teamId: null,
    type: 'personal', name: 'Mi espacio', createdAt: new Date(0),
  };
  const foreignFolder = {
    id: '22222222-2222-4222-8222-222222222222', organizationId: SPEC221_ORG, driveId: 'drive-2', parentId: 'root-2',
    name: 'Ajena', isDeleted: false, destinationId: 'dest-1', createdAt: new Date(0),
  };
  const foreignFile = {
    id: 'file-ajeno', organizationId: SPEC221_ORG, folderId: '22222222-2222-4222-8222-222222222222', name: 'secreto.pdf',
    mimeType: 'application/pdf', isDeleted: false, currentVersionId: 'v-1',
  };
  const driveRepo = fakeRepo([ownDrive]);
  const folderRepo = fakeRepo([foreignFolder]);
  const fileRepo = { ...fakeRepo([foreignFile]), createQueryBuilder: jest.fn() };
  const qb: Record<string, jest.Mock> = {};
  for (const method of ['innerJoin', 'where', 'andWhere']) qb[method] = jest.fn().mockReturnValue(qb);
  qb.getOne = jest.fn().mockResolvedValue(null);
  fileRepo.createQueryBuilder.mockReturnValue(qb);

  const repoFor = (entity: unknown) =>
    entity === Drive ? driveRepo : entity === Folder ? folderRepo : fileRepo;
  const manager = { query: jest.fn().mockResolvedValue([]), getRepository: jest.fn(repoFor) };
  const dataSource = {
    getRepository: jest.fn(repoFor),
    transaction: jest.fn(async (callback: (m: unknown) => Promise<unknown>) => callback(manager)),
  };
  const storage = { put: jest.fn(), get: jest.fn(), delete: jest.fn() };
  const service = new FilesService(
    fileRepo as never,
    folderRepo as never,
    {} as never,
    dataSource as never,
    storage as never,
    {} as never,
    {} as never,
    new DriveAccessService(dataSource as never),
  );
  jest.spyOn(service, 'getOrCreateUserDrive').mockResolvedValue({
    id: 'drive-1', name: 'Mi espacio', rootFolderId: 'root-1',
  });
  return { service, folderRepo, fileRepo, qb, dataSource, storage, manager };
};

describe('SPEC-221: un Drive ajeno responde 404 en cada operación', () => {
  it('listFolders no lista la carpeta de otro Drive', async () => {
    const { service, folderRepo } = buildForeignDriveService();

    await expect(service.listFolders(SPEC221_ORG, SPEC221_USER, '22222222-2222-4222-8222-222222222222')).rejects.toBeInstanceOf(NotFoundException);
    expect(folderRepo.find).not.toHaveBeenCalled();
  });

  it('getFolderItems no expone el contenido de la carpeta de otro Drive', async () => {
    const { service, folderRepo, fileRepo } = buildForeignDriveService();

    await expect(service.getFolderItems(SPEC221_ORG, SPEC221_USER, '22222222-2222-4222-8222-222222222222')).rejects.toBeInstanceOf(NotFoundException);
    expect(folderRepo.find).not.toHaveBeenCalled();
    expect(fileRepo.find).not.toHaveBeenCalled();
  });

  it('listFiles no lista los archivos de la carpeta de otro Drive', async () => {
    const { service, fileRepo } = buildForeignDriveService();

    await expect(service.listFiles(SPEC221_ORG, SPEC221_USER, '22222222-2222-4222-8222-222222222222')).rejects.toBeInstanceOf(NotFoundException);
    expect(fileRepo.find).not.toHaveBeenCalled();
  });

  it('createFolder no crea una subcarpeta dentro de la carpeta de otro Drive', async () => {
    const { service, folderRepo } = buildForeignDriveService();
    jest.spyOn(service as never as { ensureUserDrive: () => unknown }, 'ensureUserDrive').mockResolvedValue({
      id: 'drive-1', name: 'Mi espacio', rootFolderId: 'root-1',
    } as never);

    await expect(service.createFolder(SPEC221_ORG, SPEC221_USER, 'Nueva', '22222222-2222-4222-8222-222222222222')).rejects.toBeInstanceOf(NotFoundException);
    expect(folderRepo.save).not.toHaveBeenCalled();
  });

  it('uploadMultipartFile no sube archivos a la carpeta de otro Drive ni reserva cuota', async () => {
    const { service, dataSource, storage } = buildForeignDriveService();

    const error = await service.uploadMultipartFile({
      organizationId: SPEC221_ORG,
      ownerId: SPEC221_USER,
      folderId: '22222222-2222-4222-8222-222222222222',
      file: { originalname: 'informe.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4 contenido') },
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('downloadFileStream filtra por el Drive del solicitante y responde 404 al archivo ajeno', async () => {
    const { service, qb, storage } = buildForeignDriveService();

    await expect(service.downloadFileStream('file-ajeno', SPEC221_ORG, SPEC221_USER)).rejects.toBeInstanceOf(NotFoundException);
    expect(qb.andWhere).toHaveBeenCalledWith('folder.driveId = :driveId', { driveId: 'drive-1' });
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('softDelete filtra por el Drive del solicitante y no marca el archivo ajeno', async () => {
    const { service, qb, fileRepo } = buildForeignDriveService();

    await expect(service.softDelete('file-ajeno', SPEC221_ORG, SPEC221_USER)).rejects.toBeInstanceOf(NotFoundException);
    expect(qb.andWhere).toHaveBeenCalledWith('folder.driveId = :driveId', { driveId: 'drive-1' });
    expect(fileRepo.save).not.toHaveBeenCalled();
  });

  it('softDeleteFolder no mueve a la papelera la carpeta de otro Drive', async () => {
    const { service, folderRepo, manager } = buildForeignDriveService();

    await expect(service.softDeleteFolder('22222222-2222-4222-8222-222222222222', SPEC221_ORG, SPEC221_USER)).rejects.toBeInstanceOf(NotFoundException);
    expect(folderRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: '22222222-2222-4222-8222-222222222222', driveId: 'drive-1' }),
    }));
    // El bloqueo de cuota sí se ejecuta dentro de la transacción; lo que no debe ocurrir es escribir en carpetas o archivos.
    const writes = manager.query.mock.calls.filter(([sql]) => /UPDATE files\.(folder|file)\b/.test(String(sql)));
    expect(writes).toHaveLength(0);
  });
});
