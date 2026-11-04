import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { AuditAction, AuditResource } from '../../audit/audit.types';
import { PASSWORD_RESET_TOKEN_TTL_MINUTES } from '../constants';
import { TokenPurpose, UserStatus } from '../domain/enums';
import { OneTimeToken } from '../entities/one-time-token.entity';
import { IamErrors } from '../iam.errors';
import { normalizeEmail } from '../iam.utils';
import {
  MembershipRepository,
  OneTimeTokenRepository,
  SessionRepository,
  UserRepository,
} from '../ports/repositories';
import { OpaqueTokens, PasswordHasher } from '../ports/security';
import { TransactionContext, UnitOfWork } from '../ports/transaction';
import { EmailOutboxService } from './email-outbox.service';

/**
 * Recuperación de contraseña (SPEC-103). Token de un solo uso de 15 minutos, solo su hash en la base
 * y el correo por la outbox. Restablecer cierra TODAS las sesiones del usuario.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly uow: UnitOfWork,
    private readonly users: UserRepository,
    private readonly tokensRepo: OneTimeTokenRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly opaque: OpaqueTokens,
    private readonly outbox: EmailOutboxService,
    private readonly memberships: MembershipRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Nunca revela si el correo existe: responde antes de tocar la base, así que tarda lo mismo exista o no el
   * correo. La transacción y el envío van en segundo plano; un fallo se registra sin el correo ni el token.
   * Emitir uno nuevo invalida los anteriores sin usar. Consecuencia: si la base falla, el usuario recibe el
   * 200 genérico y no llega correo (debe volver a pedirlo).
   */
  requestReset(rawEmail: string): Promise<void> {
    this.processRequest(rawEmail).catch((err: Error) =>
      this.logger.error(`Fallo al procesar la recuperación de contraseña: ${err.name}`),
    );
    return Promise.resolve();
  }

  private async processRequest(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);

    const outboxId = await this.uow.run(async (tx) => {
      // Bloquea la fila del usuario: dos peticiones simultáneas se serializan y la segunda ve el token de la primera
      // ya confirmado, así que lo invalida. Sin el bloqueo podían quedar dos enlaces válidos a la vez.
      const user = await this.users.findByEmailForUpdate(email, tx);
      if (!user || user.status !== UserStatus.ACTIVE) return null;

      await this.tokensRepo.invalidateUnused(tx, user.id, TokenPurpose.PASSWORD_RESET);
      return this.outbox.enqueueWithToken(tx, {
        kind: 'password_reset',
        userId: user.id,
        recipientEmail: user.email,
        recipientName: user.fullName,
        purpose: TokenPurpose.PASSWORD_RESET,
        ttlMinutes: PASSWORD_RESET_TOKEN_TTL_MINUTES,
      });
    });

    if (outboxId) void this.outbox.dispatch(outboxId); // tras el commit y sin esperarlo
  }

  /**
   * Dos transacciones. La primera rechaza pronto un token inválido, sin pagar Argon2id. El hash va fuera de
   * cualquier transacción para que el bloqueo de la fila del token no dure lo que tarda. La segunda revalida
   * con el bloqueo y consume el token, cambia la contraseña y revoca las sesiones de forma atómica: si dos
   * peticiones usan el mismo token, la segunda ve `usedAt` y falla sin cambiar nada.
   */
  async reset(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = this.opaque.hash(rawToken);

    await this.uow.run((tx) => this.findUsableToken(tx, tokenHash));

    const passwordHash = await this.hasher.hash(newPassword);

    const reset = await this.uow.run(async (tx) => {
      const record = await this.findUsableToken(tx, tokenHash);
      await this.tokensRepo.markUsed(tx, record);
      await this.users.setPasswordAndVerifyEmail(tx, record.userId, passwordHash);
      await this.sessions.revokeAllActiveOf(tx, record.userId);
      const membership = await this.memberships.findActive(record.userId, undefined, tx);
      return { userId: record.userId, organizationId: membership?.organizationId };
    });

    // SPEC-405: AUTH_PASSWORD_RESET tras el commit. Sin membresía activa no hay organización que registrar.
    if (reset.organizationId) {
      void this.audit.logEvent({
        organizationId: reset.organizationId,
        actorId: reset.userId,
        action: AuditAction.AUTH_PASSWORD_RESET,
        resourceType: AuditResource.USER,
        resourceId: reset.userId,
      }).catch(() => {});
    }
  }

  /** Token de restablecimiento vigente, sin usar y de una cuenta activa; si no, INVALID_OR_EXPIRED_TOKEN. */
  private async findUsableToken(tx: TransactionContext, tokenHash: string): Promise<OneTimeToken> {
    // El filtro por propósito impide usar un token de verificación de correo para restablecer.
    const record = await this.tokensRepo.findByHashForUpdate(tx, tokenHash, TokenPurpose.PASSWORD_RESET);
    if (!record || record.usedAt || record.expiresAt <= new Date()) throw IamErrors.invalidOrExpiredToken();

    // Una cuenta que dejó de estar activa desde que se emitió el token no puede restablecerse.
    const user = await this.users.findById(record.userId, tx);
    if (!user || user.status !== UserStatus.ACTIVE) throw IamErrors.invalidOrExpiredToken();
    return record;
  }
}
