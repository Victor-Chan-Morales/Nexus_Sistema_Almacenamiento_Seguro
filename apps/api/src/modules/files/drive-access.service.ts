import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { Role } from '../iam/domain/enums';
import { Drive } from './entities/drive.entity';
import { FileRecord } from './entities/file-record.entity';
import { Folder } from './entities/folder.entity';
import { TeamMember } from './entities/team-member.entity';

export type DriveAccessLevel = 'read' | 'write' | 'owner';

/** Quien pide la operación. Siempre sale de la sesión autenticada, nunca del cliente. */
export interface DriveActor {
  organizationId: string;
  userId: string;
  /** Las rutas autenticadas lo pasan para habilitar el acceso a equipos. */
  role?: Role;
}

export interface DriveAccess {
  drive: Drive;
  level: DriveAccessLevel;
}

interface DriveAccessOptions {
  manager?: EntityManager;
  lock?: boolean;
  includeDeleted?: boolean;
}

/**
 * SPEC-221: decide a qué Drive puede acceder un miembro y en qué nivel.
 *
 * Es el único punto de Files que consulta Drives para autorizar una operación.
 * Todas las búsquedas filtran por organización: un Drive ajeno, o de otra
 * organización, responde como inexistente (404).
 */
@Injectable()
export class DriveAccessService {
  constructor(private readonly dataSource: DataSource) {}

  assertCanWrite(access: DriveAccess): void {
    if (access.level === 'read') this.denyWrite('Tu acceso al Drive es de solo lectura.');
  }

  assertCanPurge(access: DriveAccess, actor: DriveActor): void {
    if (access.drive.type === 'team') {
      if (actor.role !== Role.TENANT_ADMIN) this.denyWrite('Solo un administrador puede purgar en un Drive de equipo.');
    } else if (access.level !== 'owner') {
      this.denyWrite('Solo el dueño puede purgar en su Drive personal.');
    }
  }

  private denyWrite(message: string): never {
    throw new ForbiddenException({ code: 'DRIVE_PERMISSION_DENIED', message });
  }

  /**
   * Sin `driveId`: el Drive personal del solicitante. No crea nada; la creación sigue en
   * `getOrCreateUserDrive` y `ensureUserDrive`.
   */
  async findDrive(actor: DriveActor, driveId?: string, manager?: EntityManager): Promise<DriveAccess | null> {
    const driveRepo = (manager ?? this.dataSource).getRepository(Drive);
    if (driveId && actor.role) {
      const drive = await driveRepo.findOne({ where: { id: driveId, organizationId: actor.organizationId } });
      if (!drive) return null;
      if (drive.type === 'personal') return drive.ownerUserId === actor.userId ? { drive, level: 'owner' } : null;
      if (!drive.teamId) return null;
      if (actor.role === Role.TENANT_ADMIN) return { drive, level: 'write' };
      const member = await (manager ?? this.dataSource).getRepository(TeamMember).findOneBy({
        teamId: drive.teamId, userId: actor.userId,
      });
      return member ? { drive, level: member.level } : null;
    }
    const drive = await driveRepo.findOne({
      where: {
        ...(driveId ? { id: driveId } : {}),
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        teamId: IsNull(),
        type: 'personal',
      },
      order: { createdAt: 'ASC' },
    });
    return drive ? { drive, level: 'owner' } : null;
  }

  async listDrives(actor: DriveActor) {
    const repository = this.dataSource.getRepository(Drive);
    const personal = await this.findDrive(actor);
    const memberships = actor.role === Role.TENANT_ADMIN ? [] : await this.dataSource.getRepository(TeamMember)
      .findBy({ userId: actor.userId });
    const levels = new Map(memberships.map((member) => [member.teamId, member.level]));
    const teams = await repository.find({
      where: {
        organizationId: actor.organizationId, type: 'team',
        ...(actor.role === Role.TENANT_ADMIN ? {} : { teamId: In([...levels.keys()]) }),
      },
      order: { name: 'ASC', id: 'ASC' },
    });
    const accesses: DriveAccess[] = personal ? [personal] : [];
    for (const drive of teams) {
      const level = actor.role === Role.TENANT_ADMIN ? 'write' : levels.get(drive.teamId ?? '');
      if (level) accesses.push({ drive, level });
    }
    const roots = await this.dataSource.getRepository(Folder).findBy({
      organizationId: actor.organizationId, driveId: In(accesses.map(({ drive }) => drive.id)),
      parentId: IsNull(), isDeleted: false,
    });
    const rootByDrive = new Map(roots.map((root) => [root.driveId, root.id]));
    return { items: accesses.flatMap(({ drive, level }) => {
      const rootFolderId = rootByDrive.get(drive.id);
      return rootFolderId ? [{
        id: drive.id, name: drive.name, type: drive.type, teamId: drive.teamId,
        rootFolderId, myLevel: level,
      }] : [];
    }) };
  }

  /** Carpeta activa dentro de un Drive accesible; 404 si no existe o no es accesible. */
  async requireFolder(
    actor: DriveActor,
    folderId: string,
    options: DriveAccessOptions = {},
  ): Promise<{ folder: Folder; access: DriveAccess }> {
    const state = options.includeDeleted ? {} : { isDeleted: false };
    if (actor.role) {
      const folder = await (options.manager ?? this.dataSource).getRepository(Folder).findOne({
        where: { id: folderId, organizationId: actor.organizationId, ...state },
        ...(options.lock && options.manager ? { lock: { mode: 'pessimistic_write' as const } } : {}),
      });
      const access = folder && await this.findDrive(actor, folder.driveId, options.manager);
      if (!folder || !access) throw new NotFoundException('Carpeta ' + folderId + ' no encontrada');
      return { folder, access };
    }
    const access = await this.findDrive(actor, undefined, options.manager);
    const folder = access
      ? await (options.manager ?? this.dataSource).getRepository(Folder).findOne({
          where: {
            id: folderId,
            organizationId: actor.organizationId,
            driveId: access.drive.id,
            ...state,
          },
          ...(options.lock && options.manager ? { lock: { mode: 'pessimistic_write' as const } } : {}),
        })
      : null;
    if (!access || !folder) throw new NotFoundException('Carpeta ' + folderId + ' no encontrada');
    return { folder, access };
  }

  /**
   * Archivo de un Drive accesible, en cualquier estado de papelera: cada operación decide qué hacer
   * con él. Devuelve null si no existe, si es de otra organización o si su carpeta está en otro Drive.
   */
  async locateFile(
    actor: DriveActor,
    fileId: string,
    options: DriveAccessOptions = {},
  ): Promise<{ file: FileRecord; folder: Folder; access: DriveAccess } | null> {
    let access = actor.role ? null : await this.findDrive(actor, undefined, options.manager);
    if (!actor.role && !access) return null;

    const repos = options.manager ?? this.dataSource;
    const file = await repos.getRepository(FileRecord).findOne({
      where: { id: fileId, organizationId: actor.organizationId },
      lock: options.lock ? { mode: 'pessimistic_write' } : undefined,
    });
    if (!file) return null;

    const folder = await repos.getRepository(Folder).findOne({
      where: { id: file.folderId, organizationId: actor.organizationId },
    });
    if (folder && actor.role) access = await this.findDrive(actor, folder.driveId, options.manager);
    if (!folder || !access || folder.driveId !== access.drive.id) return null;
    return { file, folder, access };
  }
}
