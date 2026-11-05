import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { Drive } from './entities/drive.entity';
import { FileRecord } from './entities/file-record.entity';
import { Folder } from './entities/folder.entity';

export type DriveAccessLevel = 'read' | 'write' | 'owner';

/** Quien pide la operación. Siempre sale de la sesión autenticada, nunca del cliente. */
export interface DriveActor {
  organizationId: string;
  userId: string;
}

export interface DriveAccess {
  drive: Drive;
  level: DriveAccessLevel;
}

interface DriveAccessOptions {
  manager?: EntityManager;
  lock?: boolean;
}

/**
 * SPEC-221: decide a qué Drive puede acceder un miembro y en qué nivel.
 *
 * Es el único punto de Files que consulta Drives para autorizar una operación. Por ahora solo
 * existe el Drive personal (nivel `owner`); los Drives de equipo llegarán con SPEC-220 a 224 sin
 * tocar cada operación. Todas las búsquedas filtran por organización: un Drive ajeno, o de otra
 * organización, responde como inexistente (404).
 */
@Injectable()
export class DriveAccessService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Sin `driveId`: el Drive personal del solicitante. No crea nada; la creación sigue en
   * `getOrCreateUserDrive` y `ensureUserDrive`.
   */
  async findDrive(actor: DriveActor, driveId?: string, manager?: EntityManager): Promise<DriveAccess | null> {
    const driveRepo = (manager ?? this.dataSource).getRepository(Drive);
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

  /** Carpeta activa dentro de un Drive accesible; 404 si no existe o no es accesible. */
  async requireFolder(
    actor: DriveActor,
    folderId: string,
    options: DriveAccessOptions = {},
  ): Promise<{ folder: Folder; access: DriveAccess }> {
    const access = await this.findDrive(actor, undefined, options.manager);
    const folder = access
      ? await (options.manager ?? this.dataSource).getRepository(Folder).findOne({
          where: {
            id: folderId,
            organizationId: actor.organizationId,
            driveId: access.drive.id,
            isDeleted: false,
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
    const access = await this.findDrive(actor, undefined, options.manager);
    if (!access) return null;

    const repos = options.manager ?? this.dataSource;
    const file = await repos.getRepository(FileRecord).findOne({
      where: { id: fileId, organizationId: actor.organizationId },
      lock: options.lock ? { mode: 'pessimistic_write' } : undefined,
    });
    if (!file) return null;

    const folder = await repos.getRepository(Folder).findOne({
      where: { id: file.folderId, organizationId: actor.organizationId },
    });
    if (!folder || folder.driveId !== access.drive.id) return null;
    return { file, folder, access };
  }
}
