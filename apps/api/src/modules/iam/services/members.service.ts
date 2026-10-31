import { Injectable } from '@nestjs/common';
import { MEMBER_INVITATION_TOKEN_TTL_HOURS } from '../constants';
import { TokenPurpose } from '../domain/enums';
import { AddMemberDto } from '../dto/add-member.dto';
import { MemberDto, MemberListDto } from '../dto/member.dto';
import { Membership } from '../entities/membership.entity';
import { User } from '../entities/user.entity';
import { IamErrors } from '../iam.errors';
import { isUniqueViolation, normalizeEmail } from '../iam.utils';
import { AuthUser } from '../interfaces/auth-user.interface';
import { MemberAdmission } from '../member-admission';
import { MembershipRepository, OrganizationRepository, UserRepository } from '../ports/repositories';
import { PasswordHasher, OpaqueTokens } from '../ports/security';
import { UnitOfWork } from '../ports/transaction';
import { EmailOutboxService } from './email-outbox.service';

/**
 * Alta de miembros (SPEC-102). El administrador crea la cuenta con una contraseña aleatoria que nadie conoce y
 * la persona define la suya con el enlace del correo `member_invitation` (token password_reset, 24 h).
 * La organización sale siempre del actor autenticado, nunca del cuerpo.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly users: UserRepository,
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly hasher: PasswordHasher,
    private readonly opaque: OpaqueTokens,
    private readonly outbox: EmailOutboxService,
    private readonly admission: MemberAdmission,
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
}
