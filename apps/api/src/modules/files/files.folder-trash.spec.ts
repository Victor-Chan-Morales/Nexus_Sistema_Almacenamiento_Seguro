import { NotFoundException } from '@nestjs/common';
import { FilesService } from './files.service';
import { FileRecord } from './entities/file-record.entity';
import { FileVersion } from './entities/file-version.entity';
import { Folder } from './entities/folder.entity';

const ORG = 'org-1';
const USER = 'user-1';
const DRIVE = { id: 'drive-1', name: 'Mi espacio', rootFolderId: 'root-1' };
const DELETED_AT = new Date('2026-10-31T12:00:00.000Z');
const TREE = [
  { id: 'child-1', name: 'Subcarpeta', parentFolderId: 'folder-1', depth: 1, deletedAt: DELETED_AT },
  { id: 'folder-1', name: 'Proyectos', parentFolderId: 'root-1', depth: 0, deletedAt: DELETED_AT },
];

function buildService({
  root = Object.assign(new Folder(), {
    id: 'folder-1',
    organizationId: ORG,
    driveId: DRIVE.id,
    parentId: 'root-1',
    name: 'Proyectos',
    isDeleted: false,
    deletedAt: null,
  }),
  parent = Object.assign(new Folder(), {
    id: 'root-1',
    organizationId: ORG,
    driveId: DRIVE.id,
    parentId: null,
    name: 'Mi espacio',
    isDeleted: false,
  }),
  tree = TREE,
  fileRows = [{ id: 'file-1' }],
  versions = [{ id: 'version-1', fileId: 'file-1', sizeBytes: '1024', objectKey: 'org/file-1' }],
  nameTaken = false,
  expiredBytes = '0',
  storageLimit = 10_000n,
}: {
  root?: Folder | null;
  parent?: Folder | null;
  tree?: typeof TREE;
  fileRows?: Array<{ id: string }>;
  versions?: Array<{ id: string; fileId: string; sizeBytes: string; objectKey: string }>;
  nameTaken?: boolean;
  expiredBytes?: string;
  storageLimit?: bigint;
} = {}) {
  const folderRepo = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
      where.id === root?.id ? root : where.id === parent?.id ? parent : null),
    exists: jest.fn().mockResolvedValue(nameTaken),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const fileRepo = {
    find: jest.fn().mockResolvedValue(fileRows),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const versionRepo = {
    find: jest.fn().mockResolvedValue(versions),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const driveRepo = { findOne: jest.fn().mockResolvedValue(DRIVE) };
  const manager = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('WITH RECURSIVE folder_tree')) return tree;
      if (sql.includes('file.deleted_at = $3')) return [{ total: expiredBytes }];
      if (sql.includes('FROM files.file_version version')) return [{ total: '0' }];
      if (sql.includes('FROM files.reservation')) return [{ total: '0' }];
      return [];
    }),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Folder) return folderRepo;
      if (entity === FileRecord) return fileRepo;
      return versionRepo;
    }),
  };
  const dataSource = {
    getRepository: jest.fn().mockReturnValue(driveRepo),
    transaction: jest.fn((callback: (value: unknown) => Promise<unknown>) => callback(manager)),
    query: jest.fn().mockResolvedValue([]),
  };
  const storage = { delete: jest.fn().mockResolvedValue(undefined) };
  const billing = { getStorageLimitBytes: jest.fn().mockResolvedValue(storageLimit) };
  const service = new FilesService(
    {} as never,
    {} as never,
    {} as never,
    dataSource as never,
    storage as never,
    billing as never,
    {} as never,
  );
  return { service, folderRepo, fileRepo, versionRepo, manager, dataSource, storage, billing };
}

describe('FilesService folder trash', () => {
  it('moves a folder subtree and its active files to trash in one transaction', async () => {
    const { service, manager, folderRepo } = buildService();

    await expect(service.softDeleteFolder('folder-1', ORG, USER)).resolves.toEqual({ success: true, id: 'folder-1' });

    expect(folderRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'folder-1', organizationId: ORG, driveId: DRIVE.id }),
    }));
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE files.folder SET is_deleted = true, deleted_at = $3 WHERE organization_id = $1 AND folder_id = ANY($2::uuid[]) AND is_deleted = false'),
      [ORG, ['child-1', 'folder-1'], expect.any(Date)],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE files.file SET is_deleted = true, deleted_at = $3'),
      [ORG, ['child-1', 'folder-1'], expect.any(Date)],
    );
  });

  it('does not absorb a subfolder that was already in the trash', async () => {
    const previousDeletedAt = new Date('2026-10-01T12:00:00.000Z');
    const tree = TREE.map((folder) => folder.id === 'child-1'
      ? { ...folder, deletedAt: previousDeletedAt }
      : folder);
    const { service, manager } = buildService({ tree });

    await service.softDeleteFolder('folder-1', ORG, USER);

    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('AND is_deleted = false'),
      [ORG, ['child-1', 'folder-1'], expect.any(Date)],
    );
  });

  it('does not allow moving the personal-drive root to the trash', async () => {
    const rootFolder = Object.assign(new Folder(), {
      id: 'folder-1', organizationId: ORG, driveId: DRIVE.id, parentId: null, isDeleted: false,
    });
    const { service, manager } = buildService({ root: rootFolder });

    await expect(service.softDeleteFolder('folder-1', ORG, USER)).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE files.folder SET is_deleted = true'), expect.anything());
  });

  it('restores a folder subtree and recalculates quota counters', async () => {
    const deletedRoot = Object.assign(new Folder(), {
      id: 'folder-1', organizationId: ORG, driveId: DRIVE.id, parentId: 'root-1',
      name: 'Proyectos', isDeleted: true, deletedAt: DELETED_AT,
    });
    const { service, manager } = buildService({ root: deletedRoot });

    await expect(service.restoreFolder('folder-1', ORG, USER)).resolves.toEqual({
      id: 'folder-1', name: 'Proyectos', parentFolderId: 'root-1',
    });
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE files.folder SET is_deleted = false, deleted_at = NULL'),
      [ORG, ['child-1', 'folder-1'], DELETED_AT],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE files.file SET is_deleted = false, deleted_at = NULL'),
      [ORG, ['child-1', 'folder-1'], DELETED_AT],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE files.tenant_quota'),
      expect.any(Array),
    );
  });

  it('rejects restoration when the original folder name is already in use', async () => {
    const deletedRoot = Object.assign(new Folder(), {
      id: 'folder-1', organizationId: ORG, driveId: DRIVE.id, parentId: 'root-1',
      name: 'Proyectos', isDeleted: true, deletedAt: DELETED_AT,
    });
    const { service, manager } = buildService({ root: deletedRoot, nameTaken: true });

    await expect(service.restoreFolder('folder-1', ORG, USER)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FOLDER_NAME_CONFLICT' }),
      status: 409,
    });
    expect(manager.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE files.folder SET is_deleted = false'),
      expect.anything(),
    );
  });

  it('keeps an expired folder subtree in trash when restoring it would exceed the plan quota', async () => {
    const deletedRoot = Object.assign(new Folder(), {
      id: 'folder-1', organizationId: ORG, driveId: DRIVE.id, parentId: 'root-1',
      name: 'Proyectos', isDeleted: true, deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const { service, manager } = buildService({
      root: deletedRoot,
      tree: TREE.map((folder) => ({ ...folder, deletedAt: deletedRoot.deletedAt })),
      expiredBytes: '500',
      storageLimit: 400n,
    });

    await expect(service.restoreFolder('folder-1', ORG, USER)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORAGE_QUOTA_EXCEEDED' }),
      status: 422,
    });
    expect(manager.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE files.folder SET is_deleted = false'),
      expect.anything(),
    );
  });

  it('purges all files and folders in descendant-first order and removes their objects', async () => {
    const deletedRoot = Object.assign(new Folder(), {
      id: 'folder-1', organizationId: ORG, driveId: DRIVE.id, parentId: 'root-1',
      name: 'Proyectos', isDeleted: true, deletedAt: DELETED_AT,
    });
    const { service, folderRepo, fileRepo, versionRepo, storage } = buildService({ root: deletedRoot });

    await expect(service.purgeFolder('folder-1', ORG, USER)).resolves.toEqual({
      id: 'folder-1', freedBytes: 1024,
    });

    expect(versionRepo.find).toHaveBeenCalled();
    expect(fileRepo.update).toHaveBeenCalledWith({ id: 'file-1' }, { currentVersionId: null });
    expect(folderRepo.delete.mock.calls.map(([criteria]) => (criteria as { id: string }).id))
      .toEqual(['child-1', 'folder-1']);
    expect(storage.delete).toHaveBeenCalledWith('org/file-1');
  });
});
