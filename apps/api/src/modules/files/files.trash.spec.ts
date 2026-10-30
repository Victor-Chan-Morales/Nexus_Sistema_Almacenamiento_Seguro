import { FilesService } from './files.service';
import { FileVersion } from './entities/file-version.entity';

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
