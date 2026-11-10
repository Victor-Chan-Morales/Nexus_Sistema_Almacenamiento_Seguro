import { HttpException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { FilesService } from './files.service';
import { DriveAccessService } from './drive-access.service';
import { Destination } from './entities/destination.entity';
import { Drive } from './entities/drive.entity';
import { FileRecord } from './entities/file-record.entity';
import { Folder } from './entities/folder.entity';
import { TenantEncryptionKey } from './entities/tenant-encryption-key.entity';
import { TenantQuota } from './entities/tenant-quota.entity';
import { Upload } from './entities/upload.entity';
import { FolderPlacementService } from './placement/folder-placement.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { DeploymentModel } from '../iam/domain/enums';

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
  uploads = [] as Array<{ id: string; objectKey: string | null }>,
  nameTaken = false,
  expiredBytes = '0',
  storageLimit = 10_000n,
  audit = { logEvent: jest.fn().mockResolvedValue(undefined) },
}: {
  root?: Folder | null;
  parent?: Folder | null;
  tree?: typeof TREE;
  fileRows?: Array<{ id: string }>;
  versions?: Array<{ id: string; fileId: string; sizeBytes: string; objectKey: string }>;
  uploads?: Array<{ id: string; objectKey: string | null }>;
  nameTaken?: boolean;
  expiredBytes?: string;
  storageLimit?: bigint;
  audit?: { logEvent: jest.Mock };
} = {}) {
  const folderRepo = {
    findOne: jest.fn(async ({ where }: { where: { id?: string; parentId?: string | null } }) =>
      where.id === root?.id ? root : where.id === parent?.id || where.id === undefined ? parent : null),
    exists: jest.fn().mockResolvedValue(nameTaken),
    create: jest.fn((folder: Partial<Folder>) => Object.assign(new Folder(), {
      id: 'folder-created',
      createdAt: new Date('2026-10-31T12:00:00.000Z'),
      ...folder,
    })),
    save: jest.fn(async (folder: Folder) => folder),
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
  const uploadRepo = {
    find: jest.fn().mockResolvedValue(uploads),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const driveRepo = { findOne: jest.fn().mockResolvedValue(DRIVE) };
  const destinationRepo = { findOne: jest.fn().mockResolvedValue({ id: 'destination-1', location: 'cloud' }) };
  const keyRepo = { findOne: jest.fn().mockResolvedValue({ id: 'key-1' }) };
  const quotaRepo = { findOneBy: jest.fn().mockResolvedValue({ organizationId: ORG }) };
  const manager = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('WITH RECURSIVE folder_tree')) return tree;
      if (sql.includes('file.deleted_at = $3')) return [{ total: expiredBytes }];
      if (sql.includes('FROM files.file_version version')) return [{ total: '0' }];
      if (sql.includes('FROM files.reservation')) return [{ total: '0' }];
      return [];
    }),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Drive) return driveRepo;
      if (entity === Folder) return folderRepo;
      if (entity === FileRecord) return fileRepo;
      if (entity === Destination) return destinationRepo;
      if (entity === TenantEncryptionKey) return keyRepo;
      if (entity === TenantQuota) return quotaRepo;
      if (entity === Upload) return uploadRepo;
      return versionRepo;
    }),
  };
  const dataSource = {
    getRepository: jest.fn().mockReturnValue(driveRepo),
    transaction: jest.fn((callback: (value: unknown) => Promise<unknown>) => callback(manager)),
    query: jest.fn().mockResolvedValue([]),
  };
  const storage = { delete: jest.fn().mockResolvedValue(undefined) };
  const storageRouter = {
    forRead: jest.fn().mockResolvedValue(storage),
    forWrite: jest.fn(),
    defaultBucketName: 'nexus',
  };
  const billing = { getStorageLimitBytes: jest.fn().mockResolvedValue(storageLimit) };
  // Placement real; el modelo de la organización es cloud (raíz -> predeterminado).
  const placement = new FolderPlacementService(
    dataSource as never,
    { findDeploymentModel: jest.fn().mockResolvedValue(DeploymentModel.CLOUD) } as never,
  );
  const service = new FilesService(
    {} as never,
    {} as never,
    {} as never,
    dataSource as never,
    storageRouter as never,
    billing as never,
    {} as never,
    new DriveAccessService(dataSource as never),
    audit as never,
    placement,
  );
  return { service, folderRepo, fileRepo, versionRepo, uploadRepo, manager, dataSource, storage, billing, audit };
}

describe('SPEC-218: unicidad al crear una carpeta', () => {
  it('recorta el nombre y busca un conflicto activo en el mismo padre sin distinguir mayúsculas', async () => {
    const { service, folderRepo } = buildService({ nameTaken: true });
    await expect(service.createFolder(ORG, USER, '  Contratos  ')).rejects.toMatchObject({
      status: 409, response: expect.objectContaining({ code: 'FOLDER_NAME_CONFLICT' }),
    });
    expect(folderRepo.exists).toHaveBeenCalledWith({
      where: {
        organizationId: ORG, parentId: DRIVE.rootFolderId, isDeleted: false,
        name: expect.objectContaining({ objectLiteralParameters: { folderName: 'Contratos' } }),
      },
    });
    expect(folderRepo.save).not.toHaveBeenCalled();
  });

  it.each(['uq_folder_active_name_per_parent', 'other_constraint'])('maneja 23505 de %s', async (constraint) => {
    const { service, folderRepo } = buildService();
    const failure = new QueryFailedError('INSERT', [], Object.assign(new Error('duplicado'), { code: '23505', constraint }));
    folderRepo.save.mockRejectedValueOnce(failure);
    const result = service.createFolder(ORG, USER, 'Contratos');
    if (constraint === 'uq_folder_active_name_per_parent') {
      await expect(result).rejects.toMatchObject({
        status: 409, response: expect.objectContaining({ code: 'FOLDER_NAME_CONFLICT' }),
      });
    } else {
      await expect(result).rejects.toBe(failure);
    }
  });
});

describe('FilesService folder trash', () => {
  it('audits folder creation after the database transaction succeeds', async () => {
    const { service, audit } = buildService();

    await expect(service.createFolder(ORG, USER, 'Nueva carpeta')).resolves.toMatchObject({
      id: 'folder-created',
      name: 'Nueva carpeta',
      parentFolderId: 'root-1',
    });

    expect(audit.logEvent).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: USER,
      action: AuditAction.FOLDER_CREATE,
      resourceType: AuditResource.FOLDER,
      resourceId: 'folder-created',
    });
  });

  it('una carpeta principal en cloud recibe el destino predeterminado y lo devuelve con su ubicación', async () => {
    const { service, folderRepo } = buildService();

    await expect(service.createFolder(ORG, USER, 'Nueva carpeta')).resolves.toMatchObject({
      destinationId: 'destination-1',
      destinationLocation: 'cloud',
    });
    expect(folderRepo.create).toHaveBeenCalledWith(expect.objectContaining({ destinationId: 'destination-1' }));
  });

  it('una subcarpeta con destinationId responde 422 DESTINATION_SELECTION_NOT_ALLOWED y no guarda nada', async () => {
    const { service, folderRepo, audit } = buildService();

    const error = await service.createFolder(ORG, USER, 'Nueva carpeta', 'folder-1', 'destination-2').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(422);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'DESTINATION_SELECTION_NOT_ALLOWED' });
    expect(folderRepo.save).not.toHaveBeenCalled();
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('does not audit folder creation if its transaction fails', async () => {
    const { service, audit, dataSource } = buildService();
    dataSource.transaction.mockRejectedValueOnce(new Error('Database transaction failed'));

    await expect(service.createFolder(ORG, USER, 'Nueva carpeta')).rejects.toThrow('Database transaction failed');
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('moves a folder subtree and its active files to trash in one transaction', async () => {
    const { service, manager, folderRepo, audit } = buildService();

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
    expect(audit.logEvent).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: USER,
      action: AuditAction.FOLDER_DELETE,
      resourceType: AuditResource.FOLDER,
      resourceId: 'folder-1',
    });
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
    const { service, manager, audit } = buildService({ root: rootFolder });

    await expect(service.softDeleteFolder('folder-1', ORG, USER)).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE files.folder SET is_deleted = true'), expect.anything());
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('does not audit folder deletion if its transaction fails', async () => {
    const { service, audit, dataSource } = buildService();
    dataSource.transaction.mockRejectedValueOnce(new Error('Database transaction failed'));

    await expect(service.softDeleteFolder('folder-1', ORG, USER)).rejects.toThrow('Database transaction failed');
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('restores a folder subtree and recalculates quota counters', async () => {
    const deletedRoot = Object.assign(new Folder(), {
      id: 'folder-1', organizationId: ORG, driveId: DRIVE.id, parentId: 'root-1',
      name: 'Proyectos', isDeleted: true, deletedAt: DELETED_AT,
    });
    const { service, manager, audit } = buildService({ root: deletedRoot });

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
    expect(audit.logEvent).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: USER,
      action: AuditAction.FOLDER_RESTORE,
      resourceType: AuditResource.FOLDER,
      resourceId: 'folder-1',
    });
  });

  it('rejects restoration when the original folder name is already in use', async () => {
    const deletedRoot = Object.assign(new Folder(), {
      id: 'folder-1', organizationId: ORG, driveId: DRIVE.id, parentId: 'root-1',
      name: 'Proyectos', isDeleted: true, deletedAt: DELETED_AT,
    });
    const { service, manager, audit } = buildService({ root: deletedRoot, nameTaken: true });

    await expect(service.restoreFolder('folder-1', ORG, USER)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FOLDER_NAME_CONFLICT' }),
      status: 409,
    });
    expect(manager.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE files.folder SET is_deleted = false'),
      expect.anything(),
    );
    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('restores an expired folder subtree without checking the plan quota', async () => {
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

    await expect(service.restoreFolder('folder-1', ORG, USER)).resolves.toMatchObject({ id: 'folder-1' });
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE files.folder SET is_deleted = false'),
      expect.anything(),
    );
  });

  it('purges all files and folders in descendant-first order and removes their objects', async () => {
    const deletedRoot = Object.assign(new Folder(), {
      id: 'folder-1', organizationId: ORG, driveId: DRIVE.id, parentId: 'root-1',
      name: 'Proyectos', isDeleted: true, deletedAt: DELETED_AT,
    });
    const { service, folderRepo, fileRepo, versionRepo, storage, audit } = buildService({ root: deletedRoot });

    await expect(service.purgeFolder('folder-1', ORG, USER)).resolves.toEqual({
      id: 'folder-1', freedBytes: 1024,
    });

    expect(versionRepo.find).toHaveBeenCalled();
    expect(fileRepo.update).toHaveBeenCalledWith({ id: 'file-1' }, { currentVersionId: null });
    expect(folderRepo.delete.mock.calls.map(([criteria]) => (criteria as { id: string }).id))
      .toEqual(['child-1', 'folder-1']);
    expect(storage.delete).toHaveBeenCalledWith('org/file-1');
    expect(audit.logEvent).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: USER,
      action: AuditAction.FOLDER_PURGE,
      resourceType: AuditResource.FOLDER,
      resourceId: 'folder-1',
    });
  });

  it('removes upload rows before their folders and deletes objects pending cleanup once', async () => {
    const deletedRoot = Object.assign(new Folder(), {
      id: 'folder-1', organizationId: ORG, driveId: DRIVE.id, parentId: 'root-1', name: 'Proyectos',
      isDeleted: true, deletedAt: DELETED_AT,
    });
    const { service, folderRepo, uploadRepo, storage } = buildService({
      root: deletedRoot,
      uploads: [
        { id: 'upload-1', objectKey: 'org/file-1' },
        { id: 'upload-2', objectKey: 'org/pending-cleanup' },
        { id: 'upload-3', objectKey: null },
      ],
    });

    await service.purgeFolder('folder-1', ORG, USER);

    expect(uploadRepo.delete).toHaveBeenCalledTimes(1);
    expect(uploadRepo.delete.mock.invocationCallOrder[0])
      .toBeLessThan(folderRepo.delete.mock.invocationCallOrder[0]);
    expect(storage.delete.mock.calls.map(([key]) => key).sort())
      .toEqual(['org/file-1', 'org/pending-cleanup']);
  });
});
