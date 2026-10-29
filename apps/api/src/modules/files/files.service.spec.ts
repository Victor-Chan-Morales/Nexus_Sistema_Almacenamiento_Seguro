import { HttpException, HttpStatus } from '@nestjs/common';
import { FilesService } from './files.service';

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
      {} as never, {} as never, {} as never, {} as never,
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
    const storageService = { put: jest.fn(), bucketName: 'nexus' };
    const billingService = { getStorageLimitBytes: jest.fn().mockResolvedValue(BigInt(100)) };

    const service = new FilesService(
      {} as never, {} as never, {} as never,
      dataSource as never, storageService as never, billingService as never, {} as never,
    );
    jest.spyOn(service, 'getOrCreateUserDrive').mockResolvedValue({
      id: 'drive-1',
      name: 'Mi unidad',
      rootFolderId: 'folder-root',
    });
    jest.spyOn(service as never as { requirePersonalFolder: () => unknown }, 'requirePersonalFolder')
      .mockResolvedValue({ id: 'folder-1' } as never);

    const buffer = Buffer.from('%PDF-1.4 contenido de prueba'); // 28 bytes: 90 + 28 > 100
    const error = await service
      .uploadMultipartFile({
        organizationId: 'org-1',
        ownerId: 'user-1',
        folderId: 'folder-1',
        file: { originalname: 'informe.pdf', mimetype: 'application/pdf', buffer },
      })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'STORAGE_QUOTA_EXCEEDED',
    });
    expect(storageService.put).not.toHaveBeenCalled();
  });
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
    const service = new FilesService(
      fileRepository as never, folderRepository as never, {} as never,
      dataSource as never, {} as never, {} as never, {} as never,
    );
    jest.spyOn(service, 'getOrCreateUserDrive').mockResolvedValue({
      id: 'drive-1', name: 'Mi unidad', rootFolderId: 'raiz',
    });
    jest.spyOn(service as never as { requirePersonalFolder: () => unknown }, 'requirePersonalFolder')
      .mockResolvedValue(folderEntity('raiz', null) as never);
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
