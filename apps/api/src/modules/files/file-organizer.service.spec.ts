import { NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Role } from '../iam/domain/enums';
import { DestinationDefaults } from './destination-defaults.service';
import { DriveAccessService } from './drive-access.service';
import { FileRecord } from './entities/file-record.entity';
import { FileVersion } from './entities/file-version.entity';
import { Folder } from './entities/folder.entity';
import { FileOrganizerService } from './file-organizer.service';
import { FilesService } from './files.service';

const actor = { organizationId: 'org', userId: 'user', role: Role.COLABORADOR };
const error = (status: number, code: string) => ({ status, response: expect.objectContaining({ code }) });

function fixture() {
  const folder = { id: 'source', parentId: 'root', destinationId: 's3', name: 'Origen', driveId: 'drive',
    organizationId: actor.organizationId, isDeleted: false };
  const root = { ...folder, id: 'root', parentId: null };
  const target = { ...folder, id: 'target' };
  const file = { id: 'file', folderId: folder.id, name: 'documento.txt', isDeleted: false };
  const rows = [folder, root, target];
  const access = { drive: { id: 'drive' }, level: 'write' };
  const driveAccess = new DriveAccessService({} as never);
  jest.spyOn(driveAccess, 'locateFile').mockResolvedValue({ file, folder, access } as never);
  jest.spyOn(driveAccess, 'requireFolder').mockImplementation(async (_actor, id) => {
    const entry = rows.find((row) => row.id === id);
    if (!entry) throw new NotFoundException();
    return { folder: entry, access: { ...access, drive: { id: entry.driveId } } } as never;
  });
  const qb = {
    where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue(rows),
  };
  const saveFile = jest.fn();
  const saveFolder = jest.fn();
  const nameExists = jest.fn().mockResolvedValue(false);
  const query = jest.fn().mockResolvedValue([{ cycle: false }]);
  const manager = {
    createQueryBuilder: jest.fn().mockReturnValue(qb), query,
    getRepository: (entity: unknown) => {
      if (entity === FileRecord) return { existsBy: nameExists, save: saveFile };
      if (entity === FileVersion) return { findBy: jest.fn().mockResolvedValue([]) };
      if (entity === Folder) return { save: saveFolder };
      throw new Error('Repositorio inesperado');
    },
  };
  const availableFolderName = jest.fn().mockResolvedValue(undefined);
  const files = {
    lockTenantQuota: jest.fn().mockResolvedValue(undefined),
    normalizeFileName: FilesService.prototype.normalizeFileName,
    toUploadedFileDto: (record: FileRecord) => ({ id: record.id, name: record.name }),
    describeFolder: async (record: Folder) => ({ id: record.id, name: record.name, parentFolderId: record.parentId }),
    requireAvailableFolderName: availableFolderName,
    rethrowFolderNameConflict: (cause: unknown) => { throw cause; },
  } as unknown as FilesService;
  const defaults = { getDefault: jest.fn().mockResolvedValue({ id: 's3' }) } as unknown as DestinationDefaults;
  const logEvent = jest.fn().mockResolvedValue(undefined);
  const service = new FileOrganizerService(
    { transaction: async (work: (executor: typeof manager) => Promise<unknown>) => work(manager) } as never,
    driveAccess, files, defaults, { logEvent } as unknown as AuditService,
  );
  return { service, folder, file, target, root, access, qb, saveFile, saveFolder, nameExists, availableFolderName, query, logEvent };
}

describe('FileOrganizerService (SPEC-211)', () => {
  it('normaliza el nombre de archivo y mueve sin tocar sus versiones ni incluir nombres en auditoría', async () => {
    const { service, saveFile, logEvent, qb } = fixture();
    await expect(service.organizeFile(actor, 'file', { name: '  carpeta/nuevo.txt  ', folderId: 'target' }))
      .resolves.toEqual({ id: 'file', name: 'nuevo.txt' });
    expect(saveFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'file', folderId: 'target' }));
    expect(qb.orderBy).toHaveBeenCalledWith('folder.id', 'ASC');
    expect(qb.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(logEvent.mock.calls.map(([event]) => event)).toEqual(['FILE_RENAMED', 'FILE_MOVED'].map((action) => ({
      organizationId: 'org', actorId: 'user', action, resourceType: 'file', resourceId: 'file',
    })));
  });

  it('renombra y mueve una carpeta con su identidad intacta', async () => {
    const { service, saveFolder, logEvent, availableFolderName, query } = fixture();
    await expect(service.organizeFolder(actor, 'source', { name: 'Nuevo', parentId: 'target' }))
      .resolves.toEqual({ id: 'source', name: 'Nuevo', parentFolderId: 'target' });
    expect(availableFolderName).toHaveBeenCalledWith(expect.anything(), 'org', 'target', 'Nuevo', 'source');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WITH RECURSIVE'), ['org', 'drive', 'target', 'source']);
    expect(saveFolder).toHaveBeenCalledWith(expect.objectContaining({ id: 'source', parentId: 'target' }));
    expect(logEvent.mock.calls.map(([event]) => event.action)).toEqual(['FOLDER_RENAMED', 'FOLDER_MOVED']);
  });

  it('rechaza un nombre de archivo ocupado sin mutar ni auditar', async () => {
    const { service, nameExists, saveFile, logEvent } = fixture();
    nameExists.mockResolvedValue(true);
    await expect(service.organizeFile(actor, 'file', { name: 'ocupado.txt' })).rejects.toMatchObject(error(409, 'FILE_NAME_CONFLICT'));
    expect(saveFile).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('rechaza ciclos antes de guardar', async () => {
    const { service, query, saveFolder } = fixture();
    query.mockResolvedValue([{ cycle: true }]);
    await expect(service.organizeFolder(actor, 'source', { parentId: 'target' })).rejects.toMatchObject(error(422, 'FOLDER_CYCLE_NOT_ALLOWED'));
    expect(saveFolder).not.toHaveBeenCalled();
  });

  it('compara el destino efectivo y oculta otro Drive aunque sea accesible', async () => {
    const { service, target } = fixture();
    target.destinationId = 's3-distinto';
    await expect(service.organizeFile(actor, 'file', { folderId: 'target' })).rejects.toMatchObject(error(422, 'DESTINATION_MISMATCH'));
    target.driveId = 'otro-drive';
    await expect(service.organizeFolder(actor, 'source', { parentId: 'target' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza raíz, papelera, lectura y nombres inválidos', async () => {
    const { service, file, access } = fixture();
    await expect(service.organizeFolder(actor, 'root', { name: 'Cambio' })).rejects.toMatchObject(error(422, 'RESOURCE_NOT_MOVABLE'));
    file.isDeleted = true;
    await expect(service.organizeFile(actor, 'file', { name: 'Cambio' })).rejects.toMatchObject(error(422, 'RESOURCE_NOT_MOVABLE'));
    access.level = 'read';
    await expect(service.organizeFile(actor, 'file', { name: 'Cambio' })).rejects.toMatchObject(error(403, 'DRIVE_PERMISSION_DENIED'));
    await expect(service.organizeFile(actor, 'file', { name: '   ' })).rejects.toMatchObject({ status: 400 });
    await expect(service.organizeFolder(actor, 'source', {})).rejects.toMatchObject({ status: 400 });
  });
});
