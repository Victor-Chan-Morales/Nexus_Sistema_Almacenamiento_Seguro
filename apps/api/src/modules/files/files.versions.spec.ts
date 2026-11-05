import { NotFoundException } from '@nestjs/common';
import { FilesService } from './files.service';
import { DriveAccessService } from './drive-access.service';
import { Drive } from './entities/drive.entity';
import { FileRecord } from './entities/file-record.entity';
import { Folder } from './entities/folder.entity';

const DRIVE = { id: 'drive-1', organizationId: 'org-1', ownerUserId: 'user-1', teamId: null, type: 'personal' };
const FOLDER = { id: 'folder-1', organizationId: 'org-1', driveId: 'drive-1', isDeleted: false };
const FILE = {
  id: 'file-1',
  organizationId: 'org-1',
  folderId: 'folder-1',
  name: 'informe.pdf',
  isDeleted: false,
  currentVersionId: 'v3',
};

/** Fila tal como la devolvería la base: incluye columnas sensibles que el servicio no debe exponer. */
const versionRow = (versionNumber: number, sizeBytes: string, day: number) => ({
  id: `v${versionNumber}`,
  fileId: 'file-1',
  versionNumber,
  destinationId: 'destination-1',
  objectKey: `org-1/file-1/${versionNumber}.bin`,
  sizeBytes,
  checksum: `checksum-${versionNumber}`,
  encryptedDek: `dek-${versionNumber}`,
  kekId: 'kek-1',
  formatVersion: 1,
  uploadedBy: 'user-1',
  uploadedAt: new Date(Date.UTC(2026, 9, day, 12, 0, 0)),
});

const THREE_VERSIONS_DESC = [versionRow(3, '3072', 9), versionRow(2, '2048', 6), versionRow(1, '1024', 3)];

const buildService = ({
  drive = DRIVE,
  file = FILE,
  folder = FOLDER,
  versions = THREE_VERSIONS_DESC,
}: {
  drive?: unknown;
  file?: unknown;
  folder?: unknown;
  versions?: unknown[];
}) => {
  const driveRepository = { findOne: jest.fn().mockResolvedValue(drive) };
  const fileRepository = { findOne: jest.fn().mockResolvedValue(file) };
  const folderRepository = { findOne: jest.fn().mockResolvedValue(folder) };
  const repositories = new Map<unknown, unknown>([
    [Drive, driveRepository],
    [FileRecord, fileRepository],
    [Folder, folderRepository],
  ]);
  const dataSource = { getRepository: jest.fn((entity: unknown) => repositories.get(entity)) };
  const versionRepository = { find: jest.fn().mockResolvedValue(versions) };
  const service = new FilesService(
    fileRepository as never,
    {} as never,
    versionRepository as never,
    dataSource as never,
    {} as never,
    {} as never,
    {} as never,
    new DriveAccessService(dataSource as never),
  );
  return { service, versionRepository };
};

describe('FilesService.listVersions', () => {
  describe('Escenario 1: archivo con varias versiones', () => {
    it('devuelve las versiones de la más reciente a la más antigua con los campos del contrato', async () => {
      const { service, versionRepository } = buildService({});

      const result = await service.listVersions('file-1', 'org-1', 'user-1');

      expect(versionRepository.find).toHaveBeenCalledWith(expect.objectContaining({ order: { versionNumber: 'DESC' } }));
      expect(result.fileId).toBe('file-1');
      expect(result.fileName).toBe('informe.pdf');
      expect(result.currentVersion).toBe(3);
      expect(result.versions.map((item) => item.versionNumber)).toEqual([3, 2, 1]);
      for (const item of result.versions) {
        expect(Object.keys(item).sort()).toEqual(['isCurrent', 'sizeBytes', 'uploadedAt', 'versionId', 'versionNumber']);
        expect(typeof item.sizeBytes).toBe('number');
        expect(typeof item.uploadedAt).toBe('string');
        expect(new Date(item.uploadedAt).toISOString()).toBe(item.uploadedAt);
      }
      expect(result.versions[0]).toEqual({
        versionId: 'v3',
        versionNumber: 3,
        sizeBytes: 3072,
        uploadedAt: '2026-10-09T12:00:00.000Z',
        isCurrent: true,
      });
      expect(result.versions.filter((item) => item.isCurrent)).toHaveLength(1);
    });

    it('marca como actual la versión apuntada por currentVersionId aunque no sea la más reciente', async () => {
      const { service } = buildService({ file: { ...FILE, currentVersionId: 'v2' } });

      const result = await service.listVersions('file-1', 'org-1', 'user-1');

      expect(result.currentVersion).toBe(2);
      expect(result.versions.filter((item) => item.isCurrent).map((item) => item.versionId)).toEqual(['v2']);
    });
  });

  describe('Escenario 2: ajeno, de otra organización, inexistente o eliminado responde 404', () => {
    it('(a) sin Drive personal del solicitante', async () => {
      const { service, versionRepository } = buildService({ drive: null });

      await expect(service.listVersions('file-1', 'org-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(versionRepository.find).not.toHaveBeenCalled();
    });

    it('(b) archivo inexistente o de otra organización (locateFile devuelve null)', async () => {
      const { service, versionRepository } = buildService({ file: null });

      await expect(service.listVersions('file-x', 'org-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(versionRepository.find).not.toHaveBeenCalled();
    });

    it('(c) archivo eliminado', async () => {
      const { service, versionRepository } = buildService({ file: { ...FILE, isDeleted: true } });

      await expect(service.listVersions('file-1', 'org-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(versionRepository.find).not.toHaveBeenCalled();
    });

    it('(d) carpeta eliminada', async () => {
      const { service, versionRepository } = buildService({ folder: { ...FOLDER, isDeleted: true } });

      await expect(service.listVersions('file-1', 'org-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(versionRepository.find).not.toHaveBeenCalled();
    });

    it('(e) carpeta en otro Drive (locateFile devuelve null)', async () => {
      const { service, versionRepository } = buildService({ folder: { ...FOLDER, driveId: 'drive-2' } });

      await expect(service.listVersions('file-1', 'org-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(versionRepository.find).not.toHaveBeenCalled();
    });

    it('responde 404 si el archivo no tiene versión actual', async () => {
      const { service, versionRepository } = buildService({ file: { ...FILE, currentVersionId: null } });

      await expect(service.listVersions('file-1', 'org-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(versionRepository.find).not.toHaveBeenCalled();
    });

    it('responde 404 si la lista de versiones no contiene la versión actual', async () => {
      const { service } = buildService({ versions: [] });

      await expect(service.listVersions('file-1', 'org-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('Escenario 3: sin datos sensibles', () => {
    it('no expone object_key, DEK, KEK ni checksum y la consulta no selecciona esas columnas', async () => {
      const { service, versionRepository } = buildService({});

      const result = await service.listVersions('file-1', 'org-1', 'user-1');

      const serialized = JSON.stringify(result);
      for (const forbidden of ['objectKey', 'object_key', 'encryptedDek', 'encrypted_dek', 'kekId', 'kek_id', 'checksum']) {
        expect(serialized).not.toContain(forbidden);
      }
      for (const item of result.versions) {
        expect(Object.keys(item).sort()).toEqual(['isCurrent', 'sizeBytes', 'uploadedAt', 'versionId', 'versionNumber']);
      }

      const options = versionRepository.find.mock.calls[0][0] as { select: Record<string, boolean> };
      expect(Object.keys(options.select).sort()).toEqual(['id', 'sizeBytes', 'uploadedAt', 'versionNumber']);
      for (const forbidden of ['objectKey', 'encryptedDek', 'kekId', 'checksum', 'uploadedBy', 'destinationId', 'formatVersion']) {
        expect(options.select).not.toHaveProperty(forbidden);
      }
    });
  });
});
