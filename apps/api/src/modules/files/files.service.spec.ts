import { UnprocessableEntityException } from '@nestjs/common';
import { Readable } from 'stream';
import { FilesService } from './files.service';

const GB = 1_000_000_000;

/**
 * Cuota y reservas de carga (CONTRACTS.md): una carga considera `usedBytes + reservedBytes`,
 * la reserva se crea antes de validar y se libera al confirmar o fallar la carga.
 */
const build = (options: { limitBytes: number; usedBytes: number; putFails?: boolean }) => {
  const fileRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((data: unknown) => ({ id: 'file-1', ...(data as object) })),
    save: jest.fn(async (entity: unknown) => entity),
  };
  const versionRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((data: unknown) => data),
    save: jest.fn(async (entity: unknown) => entity),
    createQueryBuilder: jest.fn(() => ({
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: String(options.usedBytes) }),
    })),
  };
  const storageService = {
    put: options.putFails
      ? jest.fn().mockRejectedValue(new Error('SeaweedFS no disponible'))
      : jest.fn().mockResolvedValue(undefined),
  };
  const billingService = {
    getStorageLimitBytes: jest.fn().mockResolvedValue(BigInt(options.limitBytes)),
  };

  const service = new FilesService(
    fileRepo as never,
    {} as never,
    versionRepo as never,
    storageService as never,
    billingService as never,
  );
  return { service, storageService, versionRepo };
};

const upload = (service: FilesService, sizeBytes: number) =>
  service.uploadFile({
    organizationId: 'org-1',
    ownerId: 'user-1',
    name: 'informe.pdf',
    mimeType: 'application/pdf',
    sizeBytes,
    stream: Readable.from(['contenido']),
  });

describe('FilesService — cuota y reservas de carga', () => {
  it('acepta la carga que cabe en el plan y libera la reserva al terminar', async () => {
    const t = build({ limitBytes: 5 * GB, usedBytes: 1 * GB });

    await upload(t.service, 1 * GB);

    expect(t.storageService.put).toHaveBeenCalledTimes(1);
    // Sin cargas en curso, no debe quedar nada reservado.
    expect(await t.service.getReservedStorageBytes('org-1')).toBe(BigInt(0));
  });

  it('rechaza con 422 STORAGE_QUOTA_EXCEEDED y no escribe el objeto si la carga no cabe', async () => {
    const t = build({ limitBytes: 5 * GB, usedBytes: 4 * GB });

    const error = await upload(t.service, 2 * GB).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getStatus()).toBe(422);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
      code: 'STORAGE_QUOTA_EXCEEDED',
    });
    expect(t.storageService.put).not.toHaveBeenCalled();
  });

  it('libera la reserva aunque falle el almacenamiento, para no bloquear la cuota', async () => {
    const t = build({ limitBytes: 5 * GB, usedBytes: 0, putFails: true });

    await expect(upload(t.service, 1 * GB)).rejects.toThrow('SeaweedFS no disponible');

    expect(await t.service.getReservedStorageBytes('org-1')).toBe(BigInt(0));
  });

  it('dos cargas simultáneas se cuentan entre sí: la segunda se rechaza aunque cada una quepa sola', async () => {
    // Límite 5 GB, sin uso confirmado. Dos cargas de 3 GB caben por separado, pero no juntas.
    const t = build({ limitBytes: 5 * GB, usedBytes: 0 });
    let releaseFirst: () => void = () => undefined;
    // La primera carga se queda dentro de storage.put, con su reserva activa.
    t.storageService.put.mockImplementation(
      () => new Promise<void>((resolve) => { releaseFirst = resolve; }),
    );

    const first = upload(t.service, 3 * GB);
    await new Promise((resolve) => setImmediate(resolve));

    const error = await upload(t.service, 3 * GB).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(UnprocessableEntityException);

    releaseFirst();
    await first;
    expect(await t.service.getReservedStorageBytes('org-1')).toBe(BigInt(0));
  });

  it('getTotalStorageUsage suma uso confirmado y reservas activas', async () => {
    const t = build({ limitBytes: 5 * GB, usedBytes: 2 * GB });
    t.service.reserveUpload('org-1', 'r-1', BigInt(1 * GB));

    const usage = await t.service.getTotalStorageUsage('org-1');

    expect(usage.usedBytes).toBe(BigInt(2 * GB));
    expect(usage.reservedBytes).toBe(BigInt(1 * GB));
    expect(usage.totalBytes).toBe(BigInt(3 * GB));
  });
});
