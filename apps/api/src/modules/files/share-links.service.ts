import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { OpaqueTokens, PasswordHasher } from '../iam/ports/security';
import { DriveAccess, DriveAccessService, DriveActor } from './drive-access.service';
import { CreatedShareLinkDto, CreateShareLinkDto, ShareLinkItemDto, ShareLinksResponseDto, ShareLinkStatus } from './dto/share-link.dto';
import { FileVersion } from './entities/file-version.entity';
import { ShareLink } from './entities/share-link.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * SPEC-209: estado calculado de un enlace. Revocado gana sobre vencido; `expiresAt === now` ya cuenta como vencido.
 * Función pura y exportada: SPEC-216 la reutiliza para decidir si el enlace público se entrega.
 */
export function shareLinkStatus(link: { revokedAt: Date | null; expiresAt: Date }, now: Date): ShareLinkStatus {
  if (link.revokedAt) return 'revoked';
  if (link.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

/** Archivo escribible y su versión vigente, que el enlace fija. */
interface WritableFile {
  currentVersionId: string;
  access: DriveAccess;
}

/**
 * SPEC-209: crear, listar y revocar enlaces compartidos a la versión vigente de un archivo.
 * El token en claro solo sale en la respuesta de creación; en la base y en las respuestas queda su hash.
 * Crear, listar y revocar exigen nivel `write` u `owner`. Cualquier otro caso responde 404 sin revelar el motivo.
 */
@Injectable()
export class ShareLinksService {
  constructor(
    @InjectRepository(ShareLink)
    private readonly linkRepository: Repository<ShareLink>,
    @InjectRepository(FileVersion)
    private readonly versionRepository: Repository<FileVersion>,
    private readonly dataSource: DataSource,
    private readonly driveAccess: DriveAccessService,
    private readonly opaque: OpaqueTokens,
    private readonly hasher: PasswordHasher,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  /** Crea el enlace fijado a la versión vigente. Argon2id va fuera de la transacción para no retener el bloqueo. */
  async createLink(fileId: string, dto: CreateShareLinkDto, actor: DriveActor): Promise<CreatedShareLinkDto> {
    // Comprobación previa para fallar pronto, antes de pagar Argon2id.
    await this.requireWritableFile(fileId, actor);

    const passwordHash = dto.password ? await this.hasher.hash(dto.password) : null;
    const token = this.opaque.generate();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + dto.expiresInDays * DAY_MS);

    const link = await this.dataSource.transaction(async (manager) => {
      // Bloquea el archivo y revalida: pudo entrar en papelera o cambiar de versión vigente desde la comprobación previa.
      const { currentVersionId } = await this.requireWritableFile(fileId, actor, { manager, lock: true });
      const repo = manager.getRepository(ShareLink);
      return repo.save(
        repo.create({
          organizationId: actor.organizationId,
          versionId: currentVersionId,
          tokenHash: this.opaque.hash(token),
          passwordHash,
          expiresAt,
          createdBy: actor.userId,
          revokedAt: null,
        }),
      );
    });

    void this.auditService?.logEvent({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: AuditAction.SHARE_LINK_CREATED,
      resourceType: AuditResource.SHARE_LINK,
      resourceId: link.id,
    }).catch(() => {});

    return {
      id: link.id,
      token,
      versionId: link.versionId,
      expiresAt: link.expiresAt.toISOString(),
      hasPassword: passwordHash !== null,
      createdAt: link.createdAt.toISOString(),
    };
  }

  /** Enlaces de todas las versiones del archivo, de la más reciente a la más antigua. Nunca incluye token ni hash. */
  async listLinks(fileId: string, actor: DriveActor): Promise<ShareLinksResponseDto> {
    await this.requireWritableFile(fileId, actor);

    const rows = await this.linkRepository
      .createQueryBuilder('link')
      .innerJoin(FileVersion, 'version', 'version.id = link.versionId')
      .select([
        'link.id',
        'link.versionId',
        'link.expiresAt',
        'link.revokedAt',
        'link.createdAt',
        'link.passwordHash',
      ])
      .where('version.fileId = :fileId', { fileId })
      .andWhere('link.organizationId = :organizationId', { organizationId: actor.organizationId })
      .orderBy('link.createdAt', 'DESC')
      .getMany();

    const now = new Date();
    const items: ShareLinkItemDto[] = rows.map((link) => ({
      id: link.id,
      versionId: link.versionId,
      expiresAt: link.expiresAt.toISOString(),
      hasPassword: link.passwordHash !== null,
      status: shareLinkStatus(link, now),
      createdAt: link.createdAt.toISOString(),
      revokedAt: link.revokedAt ? link.revokedAt.toISOString() : null,
    }));
    return { items };
  }

  /**
   * Revoca el enlace. Idempotente: repetirlo responde sin cambiar `revokedAt` ni auditar otra vez.
   * Se permite aunque el archivo esté en papelera: revocar siempre debe poder cortar el acceso.
   */
  async revokeLink(linkId: string, actor: DriveActor): Promise<void> {
    const link = await this.linkRepository.findOne({
      where: { id: linkId, organizationId: actor.organizationId },
      select: { id: true, versionId: true },
    });
    if (!link) throw this.linkNotFound(linkId);

    const version = await this.versionRepository.findOne({
      where: { id: link.versionId },
      select: { id: true, fileId: true },
    });
    if (!version) throw this.linkNotFound(linkId);

    const located = await this.driveAccess.locateFile(actor, version.fileId);
    if (!located || !this.canWrite(located.access)) throw this.linkNotFound(linkId);

    const result = await this.linkRepository.update(
      { id: linkId, organizationId: actor.organizationId, revokedAt: IsNull() },
      { revokedAt: () => 'CURRENT_TIMESTAMP' },
    );
    if (result.affected !== 1) return;

    void this.auditService?.logEvent({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: AuditAction.SHARE_LINK_REVOKED,
      resourceType: AuditResource.SHARE_LINK,
      resourceId: linkId,
    }).catch(() => {});
  }

  /**
   * Localiza un archivo activo, de carpeta activa, con versión vigente y nivel de escritura.
   * Con `options`, la búsqueda toma el bloqueo dentro de la transacción de quien la llama.
   */
  private async requireWritableFile(
    fileId: string,
    actor: DriveActor,
    options: { manager?: EntityManager; lock?: boolean } = {},
  ): Promise<WritableFile> {
    const located = await this.driveAccess.locateFile(actor, fileId, options);
    if (!located) throw this.fileNotFound(fileId);
    const { file, folder, access } = located;
    if (file.isDeleted || folder.isDeleted || !file.currentVersionId || !this.canWrite(access)) {
      throw this.fileNotFound(fileId);
    }
    return { currentVersionId: file.currentVersionId, access };
  }

  private canWrite(access: DriveAccess): boolean {
    return access.level === 'write' || access.level === 'owner';
  }

  private fileNotFound(fileId: string): NotFoundException {
    return new NotFoundException('Archivo ' + fileId + ' no encontrado');
  }

  private linkNotFound(linkId: string): NotFoundException {
    return new NotFoundException('Enlace ' + linkId + ' no encontrado');
  }
}
