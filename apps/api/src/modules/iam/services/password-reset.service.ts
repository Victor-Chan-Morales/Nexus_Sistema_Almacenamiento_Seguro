import { Injectable } from '@nestjs/common';
import { PASSWORD_RESET_TOKEN_TTL_MINUTES } from '../constants';
import { TokenPurpose, UserStatus } from '../domain/enums';
import { OneTimeToken } from '../entities/one-time-token.entity';
import { IamErrors } from '../iam.errors';
import { normalizeEmail } from '../iam.utils';
import { OneTimeTokenRepository, SessionRepository, UserRepository } from '../ports/repositories';
import { OpaqueTokens, PasswordHasher } from '../ports/security';
import { TransactionContext, UnitOfWork } from '../ports/transaction';
import { EmailOutboxService } from './email-outbox.service';
import { VerificationTokenService } from './verification-token.service';

/**
 * Recuperación de contraseña (SPEC-103). Token de un solo uso de 15 minutos, solo su hash en la base
 * y el correo por la outbox. Restablecer cierra TODAS las sesiones del usuario.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly users: UserRepository,
    private readonly tokensRepo: OneTimeTokenRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly opaque: OpaqueTokens,
    private readonly tokens: VerificationTokenService,
    private readonly outbox: EmailOutboxService,
  ) {}

  /**
   * Nunca revela si el correo existe: devuelve lo mismo exista o no, y el envío no se espera
   * (evita diferencias de tiempo observables). Emitir uno nuevo invalida los anteriores sin usar.
   */
  async requestReset(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);

    const outboxId = await this.uow.run(async (tx) => {
      const user = await this.users.findByEmail(email, tx);
      if (!user || user.status !== UserStatus.ACTIVE) return null;

      await this.tokensRepo.invalidateUnused(tx, user.id, TokenPurpose.PASSWORD_RESET);
      const { rawToken, expiresAt } = await this.tokens.issueFor(
        tx,
        user.id,
        TokenPurpose.PASSWORD_RESET,
        PASSWORD_RESET_TOKEN_TTL_MINUTES,
      );
      return this.outbox.enqueue(tx, {
        kind: 'password_reset',
        userId: user.id,
        recipientEmail: user.email,
        recipientName: user.fullName,
        rawToken,
        expiresAt,
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

    await this.uow.run(async (tx) => {
      const record = await this.findUsableToken(tx, tokenHash);
      await this.tokensRepo.markUsed(tx, record);
      await this.users.setPasswordAndVerifyEmail(tx, record.userId, passwordHash);
      await this.sessions.revokeAllActiveOf(tx, record.userId);
    });
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
