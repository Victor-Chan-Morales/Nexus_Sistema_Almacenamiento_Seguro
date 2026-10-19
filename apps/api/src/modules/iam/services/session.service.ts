import { Injectable } from '@nestjs/common';
import { REFRESH_TOKEN_TTL_DAYS } from '../constants';
import { AuthResult } from '../domain/auth-result';
import { UserStatus } from '../domain/enums';
import { Membership } from '../entities/membership.entity';
import { User } from '../entities/user.entity';
import { IamErrors } from '../iam.errors';
import { IamSettings } from '../iam.settings';
import { addDays } from '../iam.utils';
import { MembershipRepository, SessionRepository, UserRepository } from '../ports/repositories';
import { AccessTokenIssuer, OpaqueTokens } from '../ports/security';
import { TransactionContext, UnitOfWork } from '../ports/transaction';

/** Ciclo de vida de la Session: abrir, rotar (refresh) y revocar (logout). */
@Injectable()
export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly uow: UnitOfWork,
    private readonly accessTokens: AccessTokenIssuer,
    private readonly opaque: OpaqueTokens,
    private readonly settings: IamSettings,
  ) {}

  /** Crea la Session (solo guarda el hash del refresh token) y emite el access token. */
  async open(tx: TransactionContext, user: User, membership: Membership): Promise<AuthResult> {
    const { token, expiresAt } = await this.accessTokens.issue({
      sub: user.id,
      org: membership.organizationId,
      role: membership.role,
    });

    const refreshToken = this.opaque.generate();
    const session = await this.sessions.create(tx, {
      userId: user.id,
      organizationId: membership.organizationId,
      refreshTokenHash: this.opaque.hash(refreshToken),
      expiresAt: addDays(REFRESH_TOKEN_TTL_DAYS),
    });

    return {
      session,
      refreshToken,
      accessToken: token,
      expiresAt,
      user: { id: user.id, fullName: user.fullName, email: user.email },
      organization: { id: membership.organization.id, name: membership.organization.name },
      role: membership.role,
    };
  }

  /**
   * Rota el refresh token. Reutilizar uno ya revocado revoca todas las sesiones del usuario.
   * La organización es la de la sesión: si su membresía ya no está activa, la sesión se rechaza.
   */
  async refresh(rawToken: string | undefined): Promise<AuthResult> {
    if (!rawToken) throw IamErrors.invalidSession();
    const refreshTokenHash = this.opaque.hash(rawToken);

    // Se devuelve null (no se lanza) para que las revocaciones se confirmen con el commit.
    const result = await this.uow.run(async (tx): Promise<AuthResult | null> => {
      const session = await this.sessions.findByRefreshHashForUpdate(tx, refreshTokenHash);
      if (!session) return null;

      if (session.isRevoked()) {
        await this.sessions.revokeAllActiveOf(tx, session.userId); // posible robo del token
        return null;
      }
      if (session.isExpired()) return null;

      const user = await this.users.findById(session.userId, tx);
      const membership = user ? await this.memberships.findActive(user.id, session.organizationId, tx) : null;
      const verifiedOk = !this.settings.requireVerifiedEmail || !!user?.emailVerified;

      await this.sessions.revoke(tx, session); // el token usado nunca vuelve a servir

      if (!user || user.status !== UserStatus.ACTIVE || user.mfaEnabled || !membership || !verifiedOk) {
        return null;
      }
      return this.open(tx, user, membership);
    });

    if (!result) throw IamErrors.invalidSession();
    return result;
  }

  async revoke(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.sessions.revokeByRefreshHash(this.opaque.hash(rawToken));
  }
}
