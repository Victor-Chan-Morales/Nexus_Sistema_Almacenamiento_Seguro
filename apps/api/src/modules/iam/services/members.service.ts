import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../audit/audit.service';
import { AuditAction, AuditResource } from '../../audit/audit.types';
import { MEMBER_INVITATION_TOKEN_TTL_HOURS } from '../constants';
import { MembershipStatus, Role, TokenPurpose, UserStatus } from '../domain/enums';
import { AddMemberDto } from '../dto/add-member.dto';
import { MemberDto, MemberListDto, MemberListItemDto } from '../dto/member.dto';
import { UpdateMemberDto } from '../dto/update-member.dto';
import { Membership } from '../entities/membership.entity';
import { User } from '../entities/user.entity';
import { IamErrors } from '../iam.errors';
import { IamSettings } from '../iam.settings';
import { assertRecipientDomain, isUniqueViolation, normalizeEmail } from '../iam.utils';
import { AuthUser } from '../interfaces/auth-user.interface';
import { MemberAdmission } from '../member-admission';
import { EmailDomainChecker } from '../ports/email-domain-checker';
import {
  MembershipRepository,
  OrganizationRepository,
  SessionRepository,
  UserRepository,
} from '../ports/repositories';
import { PasswordHasher, OpaqueTokens } from '../ports/security';
import { TransactionContext, UnitOfWork } from '../ports/transaction';
import { AccountNotices } from './account-notices.service';
import { EmailOutboxService } from './email-outbox.service';

/**
 * Alta (SPEC-102), listado (SPEC-104) y administración (SPEC-108) de miembros.
 * Alta de miembros (SPEC-102). El administrador crea la cuenta con una contraseña aleatoria que nadie conoce y
 * la persona define la suya con el enlace del correo `member_invitation` (token password_reset, 24 h).
 * La organización sale siempre del actor autenticado, nunca del cuerpo.
 */
@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly uow: UnitOfWork,
    private readonly users: UserRepository,
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly hasher: PasswordHasher,
    private readonly opaque: OpaqueTokens,
    private readonly outbox: EmailOutboxService,
    private readonly admission: MemberAdmission,
    private readonly audit: AuditService,
    private readonly sessions: SessionRepository,
    private readonly notices: AccountNotices,
    private readonly settings: IamSettings,
    private readonly emailDomains: EmailDomainChecker,
  ) {}

  /**
   * Miembros de la organización del actor (SPEC-104). Se mapea a un DTO explícito: la entidad User
   * nunca sale del servicio. totalMembers cuenta todos los listados; el cupo del plan solo los activos (SPEC-102).
   */
  async list(actor: AuthUser): Promise<MemberListDto> {
    const [memberships, userLimit] = await Promise.all([
      this.memberships.listByOrganization(actor.organizationId),
      this.admission.userLimit(actor.organizationId),
    ]);
    return {
      members: memberships.map((membership) => ({
        id: membership.id,
        userId: membership.userId,
        fullName: membership.user.fullName,
        email: membership.user.email,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.createdAt.toISOString(),
      })),
      totalMembers: memberships.length,
      userLimit,
    };
  }

  async addMember(actor: AuthUser, dto: AddMemberDto): Promise<MemberDto> {
    const email = normalizeEmail(dto.email);
    if (this.settings.checkEmailDomain) await assertRecipientDomain(email, this.emailDomains, this.logger);
    // El límite se lee antes de la transacción: la fuente usa otra conexión del pool y, leída dentro,
    // con varias altas simultáneas agotaría el pool mientras cada una mantiene la suya. Sin fuente o sin plan es 0.
    const limit = (await this.admission.userLimit(actor.organizationId)) ?? 0;

    let created: { user: User; membership: Membership; outboxId: string };
    try {
      created = await this.uow.run(async (tx) => {
        // Serializa las altas de esta organización: sin esto, dos altas simultáneas podrían superar el límite.
        if (!(await this.organizations.lockById(tx, actor.organizationId))) {
          throw IamErrors.noActiveMembership();
        }

        const existing = await this.users.findByEmail(email, tx);
        if (existing) {
          // Una cuenta sin ninguna membresía tampoco se reutiliza: se trata como de otra organización.
          const organizationIds = await this.memberships.organizationIdsOfUser(tx, existing.id);
          throw organizationIds.includes(actor.organizationId)
            ? IamErrors.memberAlreadyExists()
            : IamErrors.emailBelongsToOtherOrganization();
        }

        const active = await this.memberships.countActiveInOrganization(tx, actor.organizationId);
        if (active >= limit) throw IamErrors.userLimitExceeded();

        // Argon2 solo cuando el alta puede prosperar: las rechazadas no pagan el hash.
        const unusablePasswordHash = await this.hasher.hash(this.opaque.generate());
        const user = await this.users.create(tx, {
          email,
          fullName: dto.fullName,
          passwordHash: unusablePasswordHash,
        });
        const membership = await this.memberships.create(tx, {
          userId: user.id,
          organizationId: actor.organizationId,
          role: dto.role,
        });

        const outboxId = await this.outbox.enqueueWithToken(tx, {
          kind: 'member_invitation',
          userId: user.id,
          recipientEmail: user.email,
          recipientName: user.fullName,
          purpose: TokenPurpose.PASSWORD_RESET,
          ttlMinutes: MEMBER_INVITATION_TOKEN_TTL_HOURS * 60,
        });
        return { user, membership, outboxId };
      });
    } catch (err) {
      // Carrera con un registro del mismo correo en otra organización (la restricción UNIQUE de iam.user).
      if (isUniqueViolation(err)) throw IamErrors.emailBelongsToOtherOrganization();
      throw err;
    }

    // Tras el commit y sin esperarlo: si el correo falla queda pendiente en la outbox (nunca lanza).
    void this.outbox.dispatch(created.outboxId);

    // SPEC-405: MEMBER_ADDED tras el commit
    void this.audit.logEvent({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: AuditAction.MEMBER_ADDED,
      resourceType: AuditResource.MEMBERSHIP,
      resourceId: created.membership.id,
    }).catch(() => {});

    return {
      id: created.membership.id,
      userId: created.user.id,
      email: created.user.email,
      fullName: created.user.fullName,
      role: dto.role,
      status: created.membership.status,
      createdAt: created.membership.createdAt.toISOString(),
    };
  }

  /**
   * Cambia el rol y/o el estado de un miembro (SPEC-108). Todo dentro de la transacción que bloquea la organización
   * (el mismo candado del alta): serializa los cambios y los cupos. Orden: actor vigente → membresía de esta organización
   * (404) → CANNOT_MODIFY_SELF → LAST_ADMIN_REQUIRED → cupo (solo al reactivar) → escribir → revocar sesiones.
   */
  async update(actor: AuthUser, membershipId: string, dto: UpdateMemberDto): Promise<MemberListItemDto> {
    // Solo al reactivar: igual que el alta, el límite se lee fuera de la transacción (la fuente usa otra conexión).
    const limit =
      dto.status === MembershipStatus.ACTIVE ? ((await this.admission.userLimit(actor.organizationId)) ?? 0) : 0;

    const outcome = await this.uow.run(async (tx) => {
      const { target } = await this.loadTarget(tx, actor, membershipId);
      const isSelf = target.userId === actor.userId;

      // Sobre uno mismo solo se puede cambiar el rol, y aun así sin dejar la organización sin administrador.
      if (isSelf && dto.status === MembershipStatus.SUSPENDED) throw IamErrors.cannotModifySelf();

      const roleChanged = dto.role !== undefined && dto.role !== target.role;
      const statusChanged = dto.status !== undefined && dto.status !== target.status;

      const wasActiveAdmin = target.role === Role.TENANT_ADMIN && target.status === MembershipStatus.ACTIVE;
      const losesAdmin =
        (roleChanged && dto.role !== Role.TENANT_ADMIN) || (statusChanged && dto.status === MembershipStatus.SUSPENDED);
      if (wasActiveAdmin && losesAdmin && (await this.memberships.countActiveAdmins(tx, actor.organizationId)) <= 1) {
        throw IamErrors.lastAdminRequired();
      }

      const reactivating = statusChanged && dto.status === MembershipStatus.ACTIVE;
      const suspending = statusChanged && dto.status === MembershipStatus.SUSPENDED;
      if (reactivating && (await this.memberships.countActiveInOrganization(tx, actor.organizationId)) >= limit) {
        throw IamErrors.userLimitExceeded();
      }

      if (roleChanged) await this.memberships.updateRole(tx, target.id, dto.role as Role);
      if (statusChanged) await this.memberships.updateStatus(tx, target.id, dto.status as MembershipStatus);
      // Suspender cierra las sesiones: el refresh deja de servir. El access token vigente ya muere con el 401 de
      // JwtStrategy, que revalida la membresía en cada solicitud.
      if (suspending) {
        await this.sessions.revokeAllActiveOf(tx, target.userId);
      }

      const actions: AuditAction[] = [];
      if (roleChanged) actions.push(AuditAction.MEMBER_ROLE_CHANGED);
      if (statusChanged) {
        actions.push(dto.status === MembershipStatus.SUSPENDED ? AuditAction.MEMBER_SUSPENDED : AuditAction.MEMBER_REACTIVATED);
      }
      const member: MemberListItemDto = {
        id: target.id,
        userId: target.userId,
        fullName: target.user.fullName,
        email: target.user.email,
        role: roleChanged ? (dto.role as Role) : target.role,
        status: statusChanged ? (dto.status as MembershipStatus) : target.status,
        joinedAt: target.createdAt.toISOString(),
      };
      return { member, actions, suspending };
    });

    this.auditAfterCommit(actor, outcome.member.id, outcome.actions);
    if (outcome.suspending) await this.notices.memberStatusChanged(outcome.member);
    return outcome.member;
  }

  /**
   * Elimina a un miembro (SPEC-108): desaparece la membresía (el cupo se libera), la cuenta queda `inactive` y se
   * revocan sus sesiones. Sus archivos no se borran: siguen ocupando cuota y nadie puede abrirlos.
   */
  async remove(actor: AuthUser, membershipId: string): Promise<void> {
    const recipient = await this.uow.run(async (tx) => {
      const { target } = await this.loadTarget(tx, actor, membershipId);

      if (target.userId === actor.userId) throw IamErrors.cannotModifySelf();
      if (
        target.role === Role.TENANT_ADMIN &&
        target.status === MembershipStatus.ACTIVE &&
        (await this.memberships.countActiveAdmins(tx, actor.organizationId)) <= 1
      ) {
        throw IamErrors.lastAdminRequired();
      }

      await this.memberships.remove(tx, target.id);
      await this.users.setStatus(tx, target.userId, UserStatus.INACTIVE);
      await this.sessions.revokeAllActiveOf(tx, target.userId);
      return { userId: target.userId, email: target.user.email };
    });

    this.auditAfterCommit(actor, membershipId, [AuditAction.MEMBER_REMOVED]);
    await this.notices.memberStatusChanged(recipient);
  }

  /**
   * Bloquea la organización, comprueba que el actor sigue siendo administrador activo (su sesión pudo validarse antes de
   * que otro administrador lo eliminara: así dos administradores que se eliminan a la vez no se llevan a los dos) y
   * carga la membresía objetivo filtrando por la organización del actor: ajena o inexistente es 404.
   */
  private async loadTarget(tx: TransactionContext, actor: AuthUser, membershipId: string): Promise<{ target: Membership }> {
    if (!(await this.organizations.lockById(tx, actor.organizationId))) throw IamErrors.noActiveMembership();

    const actorMembership = await this.memberships.findActive(actor.userId, actor.organizationId, tx);
    if (!actorMembership) throw IamErrors.noActiveMembership();
    if (actorMembership.role !== Role.TENANT_ADMIN) throw IamErrors.forbiddenRole();

    const target = await this.memberships.findInOrganization(tx, membershipId, actor.organizationId);
    if (!target) throw IamErrors.memberNotFound();
    return { target };
  }

  /** Tras el commit y sin esperarlo. Una operación con varios eventos los comparte bajo un mismo correlationId. */
  private auditAfterCommit(actor: AuthUser, membershipId: string, actions: AuditAction[]): void {
    const correlationId = randomUUID();
    for (const action of actions) {
      void this.audit
        .logEvent({
          organizationId: actor.organizationId,
          actorId: actor.userId,
          action,
          resourceType: AuditResource.MEMBERSHIP,
          resourceId: membershipId,
          correlationId,
        })
        .catch(() => {});
    }
  }
}
