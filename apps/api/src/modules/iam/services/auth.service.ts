import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AuditService } from '../../audit/audit.service';
import { AuditAction, AuditResource } from '../../audit/audit.types';
import { AuthResult } from '../domain/auth-result';
import { UserStatus } from '../domain/enums';
import { IamErrors } from '../iam.errors';
import { IamSettings } from '../iam.settings';
import { normalizeEmail } from '../iam.utils';
import { MembershipRepository, UserRepository } from '../ports/repositories';
import { PasswordHasher } from '../ports/security';
import { UnitOfWork } from '../ports/transaction';
import { EmailVerificationService } from './email-verification.service';
import { SessionService } from './session.service';

/**
 * AuthService del diagrama de clases.
 *   authenticate(email, password) → Session    ✔ implementado
 *   verifyEmail(token)                         ✔ implementado (CONTRACTS.md v0.4)
 *   requestPasswordReset(email)                ⏳ pendiente: sin contrato aprobado
 *   verifyTotp(userId, code)                   ⛔ fuera de alcance (MFA/TOTP); authenticate falla cerrado si mfaEnabled
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';

  constructor(
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly verification: EmailVerificationService,
    private readonly uow: UnitOfWork,
    private readonly settings: IamSettings,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Hash señuelo para igualar el tiempo de respuesta cuando el correo no existe.
    this.dummyHash = await this.hasher.hash(randomBytes(16).toString('hex'));
  }

  async authenticate(email: string, password: string): Promise<AuthResult> {
    const user = await this.users.findByEmail(normalizeEmail(email));

    if (!user) {
      await this.hasher.verify(this.dummyHash, password);
      throw IamErrors.invalidCredentials();
    }
    if (!(await this.hasher.verify(user.passwordHash, password))) {
      throw IamErrors.invalidCredentials();
    }
    // Cuenta inactiva o bloqueada: misma respuesta que una contraseña incorrecta (no revela el estado).
    if (user.status !== UserStatus.ACTIVE) throw IamErrors.invalidCredentials();

    // Desde aquí la contraseña es correcta: ya se puede informar el estado de la cuenta sin enumerar usuarios.
    if (user.mfaEnabled) throw IamErrors.mfaNotSupported(); // fail-closed: no se omite un segundo factor
    if (this.settings.requireVerifiedEmail && !user.emailVerified) throw IamErrors.emailNotVerified();

    const membership = await this.memberships.findActive(user.id);
    if (!membership) throw IamErrors.noActiveMembership();

    const result = await this.uow.run((tx) => this.sessions.open(tx, user, membership));

    // SPEC-405: AUTH_LOGIN tras abrir la sesión, fuera de la transacción
    void this.audit.logEvent({
      organizationId: result.organization.id,
      actorId: result.user.id,
      action: AuditAction.AUTH_LOGIN,
      resourceType: AuditResource.USER,
      resourceId: result.user.id,
    }).catch(() => {});

    return result;
  }

  verifyEmail(token: string): Promise<void> {
    return this.verification.verify(token);
  }
}
