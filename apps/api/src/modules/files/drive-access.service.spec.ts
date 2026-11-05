import { NotFoundException } from '@nestjs/common';
import { DriveAccessService } from './drive-access.service';
import { Drive } from './entities/drive.entity';
import { FileRecord } from './entities/file-record.entity';
import { Folder } from './entities/folder.entity';

/**
 * SPEC-221: DriveAccessService decide qué Drive ve cada miembro.
 * Con dobles se verifica que cada búsqueda filtra por organización y por propietario, que un Drive
 * ajeno responde como inexistente y que la lectura no crea nada.
 */
const ORG = 'org-1';
const ACTOR = { organizationId: ORG, userId: 'user-1' };
const PERSONAL_DRIVE = Object.assign(new Drive(), { id: 'drive-1', organizationId: ORG, ownerUserId: 'user-1', type: 'personal' as const, teamId: null, name: 'Mi espacio' });

/**
 * Simula la consulta real: solo devuelve un Drive si coincide con el filtro recibido.
 * Así un filtro de organización o de propietario olvidado cambia el resultado.
 */
const buildDataSource = (drives: Drive[], folders: Folder[] = [], files: FileRecord[] = []) => {
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && '_type' in (value as object)) return true; // IsNull(): se ignora en el doble
      return row[key] === value;
    });
  const repo = (rows: Array<Record<string, unknown>>) => ({
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((row) => matches(row, where)) ?? null),
    save: jest.fn(),
    create: jest.fn(),
  });
  const driveRepo = repo(drives as never);
  const folderRepo = repo(folders as never);
  const fileRepo = repo(files as never);
  const dataSource = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Drive) return driveRepo;
      if (entity === Folder) return folderRepo;
      if (entity === FileRecord) return fileRepo;
      throw new Error('repositorio inesperado');
    }),
  };
  return { dataSource, driveRepo, folderRepo, fileRepo };
};

describe('SPEC-221: DriveAccessService', () => {
  describe('findDrive', () => {
    it('escenario 2: devuelve el Drive personal del solicitante con nivel owner', async () => {
      const { dataSource } = buildDataSource([PERSONAL_DRIVE]);
      const service = new DriveAccessService(dataSource as never);

      const access = await service.findDrive(ACTOR);

      expect(access).toEqual({ drive: PERSONAL_DRIVE, level: 'owner' });
    });

    it('escenario 3: el Drive personal de otro miembro responde como inexistente', async () => {
      const { dataSource } = buildDataSource([PERSONAL_DRIVE]);
      const service = new DriveAccessService(dataSource as never);

      await expect(service.findDrive({ organizationId: ORG, userId: 'user-2' })).resolves.toBeNull();
    });

    it('escenario 3: el Drive personal de otra organización responde como inexistente', async () => {
      const { dataSource } = buildDataSource([PERSONAL_DRIVE]);
      const service = new DriveAccessService(dataSource as never);

      await expect(service.findDrive({ organizationId: 'org-2', userId: 'user-1' })).resolves.toBeNull();
    });

    it('con driveId ajeno responde como inexistente, aunque exista', async () => {
      const { dataSource } = buildDataSource([PERSONAL_DRIVE]);
      const service = new DriveAccessService(dataSource as never);

      await expect(service.findDrive(ACTOR, 'drive-otro')).resolves.toBeNull();
    });

    it('no crea ningún Drive cuando el solicitante no tiene uno', async () => {
      const { dataSource, driveRepo } = buildDataSource([]);
      const service = new DriveAccessService(dataSource as never);

      await expect(service.findDrive(ACTOR)).resolves.toBeNull();
      expect(driveRepo.save).not.toHaveBeenCalled();
      expect(driveRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('requireFolder', () => {
    const FOLDER_OWN = Object.assign(new Folder(), { id: 'folder-1', organizationId: ORG, driveId: 'drive-1', isDeleted: false });
    const FOLDER_FOREIGN = Object.assign(new Folder(), { id: 'folder-ajena', organizationId: ORG, driveId: 'drive-otro', isDeleted: false });

    it('devuelve la carpeta activa del Drive accesible junto con su nivel', async () => {
      const { dataSource } = buildDataSource([PERSONAL_DRIVE], [FOLDER_OWN]);
      const service = new DriveAccessService(dataSource as never);

      const result = await service.requireFolder(ACTOR, 'folder-1');

      expect(result.folder).toBe(FOLDER_OWN);
      expect(result.access).toEqual({ drive: PERSONAL_DRIVE, level: 'owner' });
    });

    it('escenario 3: una carpeta de otro Drive responde 404 sin revelar que existe', async () => {
      const { dataSource } = buildDataSource([PERSONAL_DRIVE], [FOLDER_FOREIGN]);
      const service = new DriveAccessService(dataSource as never);

      const error = await service.requireFolder(ACTOR, 'folder-ajena').catch((err: unknown) => err);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).message).toBe('Carpeta folder-ajena no encontrada');
    });

    it('responde 404 cuando el solicitante no tiene Drive personal', async () => {
      const { dataSource } = buildDataSource([], [FOLDER_OWN]);
      const service = new DriveAccessService(dataSource as never);

      await expect(service.requireFolder(ACTOR, 'folder-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('locateFile', () => {
    const FOLDER_OWN = Object.assign(new Folder(), { id: 'folder-1', organizationId: ORG, driveId: 'drive-1', isDeleted: true });
    const FOLDER_FOREIGN = Object.assign(new Folder(), { id: 'folder-ajena', organizationId: ORG, driveId: 'drive-otro', isDeleted: false });
    const FILE_OWN = Object.assign(new FileRecord(), { id: 'file-1', organizationId: ORG, folderId: 'folder-1', isDeleted: true });
    const FILE_FOREIGN = Object.assign(new FileRecord(), { id: 'file-ajeno', organizationId: ORG, folderId: 'folder-ajena', isDeleted: false });

    it('localiza un archivo en papelera del Drive accesible, sin filtrar por estado de papelera', async () => {
      const { dataSource } = buildDataSource([PERSONAL_DRIVE], [FOLDER_OWN], [FILE_OWN]);
      const service = new DriveAccessService(dataSource as never);

      const result = await service.locateFile(ACTOR, 'file-1');

      expect(result).toEqual({ file: FILE_OWN, folder: FOLDER_OWN, access: { drive: PERSONAL_DRIVE, level: 'owner' } });
    });

    it('escenario 3: un archivo cuya carpeta está en otro Drive devuelve null', async () => {
      const { dataSource } = buildDataSource([PERSONAL_DRIVE], [FOLDER_FOREIGN], [FILE_FOREIGN]);
      const service = new DriveAccessService(dataSource as never);

      await expect(service.locateFile(ACTOR, 'file-ajeno')).resolves.toBeNull();
    });

    it('un archivo de otra organización devuelve null', async () => {
      const { dataSource } = buildDataSource([PERSONAL_DRIVE], [FOLDER_OWN], [FILE_OWN]);
      const service = new DriveAccessService(dataSource as never);

      await expect(service.locateFile({ organizationId: 'org-2', userId: 'user-1' }, 'file-1')).resolves.toBeNull();
    });
  });
});
