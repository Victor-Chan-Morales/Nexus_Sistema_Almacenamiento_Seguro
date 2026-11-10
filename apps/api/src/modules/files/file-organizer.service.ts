import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { DestinationDefaults } from './destination-defaults.service';
import { DriveAccessService, DriveActor } from './drive-access.service';
import { OrganizeFileDto, OrganizeFolderDto } from './dto/organize.dto';
import { FileRecord } from './entities/file-record.entity';
import { FileVersion } from './entities/file-version.entity';
import { Folder } from './entities/folder.entity';
import { FilesService } from './files.service';

@Injectable()
export class FileOrganizerService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly driveAccess: DriveAccessService,
    private readonly files: FilesService,
    private readonly defaults: DestinationDefaults,
    private readonly audit: AuditService,
  ) {}

  async organizeFile(actor: DriveActor, id: string, dto: OrganizeFileDto) {
    const name = this.requestedName(dto.name, dto.folderId);
    const { resource, renamed, moved } = await this.dataSource.transaction(async (manager) => {
      // El mismo bloqueo que usa la carga: nadie puede crear o restaurar ese nombre mientras lo comprobamos.
      await this.files.lockTenantQuota(manager, actor.organizationId);
      const located = await this.driveAccess.locateFile(actor, id, { manager, lock: true });
      if (!located) throw new NotFoundException('Archivo no encontrado');
      const { file, folder, access } = located;
      this.driveAccess.assertCanWrite(access);
      if (file.isDeleted || folder.isDeleted) throw this.notMovable();

      const targetId = dto.folderId?.toLowerCase() ?? folder.id;
      await this.requireTarget(actor, targetId, access.drive.id, manager);
      const locked = await this.lockFolders(manager, actor.organizationId, [folder.id, targetId]);
      const origin = locked.get(folder.id);
      const target = locked.get(targetId);
      if (!origin || !target) throw new NotFoundException('Carpeta no encontrada');
      if (origin.isDeleted || target.isDeleted) throw this.notMovable();
      const moved = target.id !== file.folderId;
      if (moved) await this.requireSameDestination(manager, actor.organizationId, origin, target);

      const newName = name ?? file.name;
      const renamed = newName !== file.name;
      if (renamed || moved) {
        const repository = manager.getRepository(FileRecord);
        if (await repository.existsBy({
          organizationId: actor.organizationId, folderId: target.id, name: newName, isDeleted: false, id: Not(id),
        })) {
          throw new ConflictException({ code: 'FILE_NAME_CONFLICT', message: 'Ya existe un archivo con ese nombre' });
        }
        file.name = newName;
        file.folderId = target.id;
        await repository.save(file);
      }
      const versions = await manager.getRepository(FileVersion).findBy({ fileId: id });
      return { resource: this.files.toUploadedFileDto(file, versions), renamed, moved };
    });
    await this.recordChanges(actor, id, AuditResource.FILE, renamed, moved);
    return resource;
  }

  async organizeFolder(actor: DriveActor, id: string, dto: OrganizeFolderDto) {
    const name = this.requestedName(dto.name, dto.parentId);
    const { resource, renamed, moved } = await this.dataSource.transaction(async (manager) => {
      await this.files.lockTenantQuota(manager, actor.organizationId);
      const { folder, access } = await this.driveAccess.requireFolder(actor, id, { manager, includeDeleted: true });
      this.driveAccess.assertCanWrite(access);
      if (!folder.parentId || folder.isDeleted) throw this.notMovable();

      const targetId = dto.parentId?.toLowerCase() ?? folder.parentId;
      await this.requireTarget(actor, targetId, access.drive.id, manager);
      const locked = await this.lockFolders(manager, actor.organizationId, [folder.id, targetId]);
      const source = locked.get(folder.id);
      const target = locked.get(targetId);
      if (!source || !target) throw new NotFoundException('Carpeta no encontrada');
      if (!source.parentId || source.isDeleted || target.isDeleted) throw this.notMovable();
      const moved = source.parentId !== target.id;
      if (moved) {
        await this.rejectCycle(manager, source, target.id);
        await this.requireSameDestination(manager, actor.organizationId, source, target);
      }
      const newName = name ?? source.name;
      const renamed = newName !== source.name;
      if (renamed || moved) {
        const repository = manager.getRepository(Folder);
        await this.files.requireAvailableFolderName(repository, actor.organizationId, target.id, newName, source.id);
        source.parentId = target.id;
        source.name = newName;
        await repository.save(source);
      }
      return { resource: await this.files.describeFolder(source, manager), renamed, moved };
    }).catch((error: unknown) => this.files.rethrowFolderNameConflict(error));
    await this.recordChanges(actor, id, AuditResource.FOLDER, renamed, moved);
    return resource;
  }

  private requestedName(name: string | undefined, parentId: string | undefined): string | undefined {
    if (name === undefined && parentId === undefined) {
      throw new BadRequestException('Indica un nombre o una carpeta de destino');
    }
    return name === undefined ? undefined : this.files.normalizeFileName(name);
  }

  private async requireTarget(actor: DriveActor, id: string, driveId: string, manager: EntityManager) {
    const { access } = await this.driveAccess.requireFolder(actor, id, { manager, includeDeleted: true });
    if (access.drive.id !== driveId) throw new NotFoundException('Carpeta de destino no encontrada');
  }

  private async lockFolders(manager: EntityManager, organizationId: string, ids: string[]) {
    const rows = await manager.createQueryBuilder(Folder, 'folder')
      .where({ organizationId, id: In(ids) })
      .orderBy('folder.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async requireSameDestination(manager: EntityManager, organizationId: string, source: Folder, target: Folder) {
    if (source.destinationId === target.destinationId) return;
    const fallback = !source.destinationId || !target.destinationId
      ? (await this.defaults.getDefault(manager, organizationId))?.id : undefined;
    if ((source.destinationId ?? fallback) !== (target.destinationId ?? fallback)) {
      throw new UnprocessableEntityException({
        code: 'DESTINATION_MISMATCH', message: 'El origen y el destino usan almacenes distintos.',
      });
    }
  }

  private async rejectCycle(manager: EntityManager, source: Folder, targetId: string) {
    const [result] = await manager.query<{ cycle: boolean }[]>(
      `WITH RECURSIVE ancestry AS (
        SELECT folder_id, parent_folder_id FROM files.folder
        WHERE organization_id = $1 AND drive_id = $2 AND folder_id = $3
        UNION
        SELECT parent.folder_id, parent.parent_folder_id FROM files.folder parent
        JOIN ancestry child ON parent.folder_id = child.parent_folder_id
        WHERE parent.organization_id = $1 AND parent.drive_id = $2
      )
      SELECT EXISTS(SELECT 1 FROM ancestry WHERE folder_id = $4) AS cycle`,
      [source.organizationId, source.driveId, targetId, source.id],
    );
    if (result.cycle) {
      throw new UnprocessableEntityException({
        code: 'FOLDER_CYCLE_NOT_ALLOWED', message: 'No se puede mover una carpeta dentro de sí misma ni de sus subcarpetas.',
      });
    }
  }

  private notMovable() {
    return new UnprocessableEntityException({
      code: 'RESOURCE_NOT_MOVABLE', message: 'La raíz y los elementos en papelera no se pueden renombrar ni mover.',
    });
  }

  private async recordChanges(actor: DriveActor, id: string, kind: AuditResource.FILE | AuditResource.FOLDER, renamed: boolean, moved: boolean) {
    const file = kind === AuditResource.FILE;
    const actions: AuditAction[] = [];
    if (renamed) actions.push(file ? AuditAction.FILE_RENAMED : AuditAction.FOLDER_RENAMED);
    if (moved) actions.push(file ? AuditAction.FILE_MOVED : AuditAction.FOLDER_MOVED);
    for (const action of actions) {
      await this.audit.logEvent({
        organizationId: actor.organizationId, actorId: actor.userId, action, resourceType: kind, resourceId: id,
      }).catch(() => {});
    }
  }
}
