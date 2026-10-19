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
