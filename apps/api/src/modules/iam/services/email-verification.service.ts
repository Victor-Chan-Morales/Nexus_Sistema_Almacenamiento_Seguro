import { Injectable, Logger } from '@nestjs/common';
import { RESEND_VERIFICATION_COOLDOWN_SECONDS, RESEND_VERIFICATION_MAX_PER_DAY } from '../constants';
import { TokenPurpose, UserStatus } from '../domain/enums';
import { User } from '../entities/user.entity';
import { IamErrors } from '../iam.errors';
import { normalizeEmail } from '../iam.utils';
import { OneTimeTokenRepository, UserRepository } from '../ports/repositories';
import { OpaqueTokens } from '../ports/security';
import { TransactionContext, UnitOfWork } from '../ports/transaction';
import { EmailOutboxService } from './email-outbox.service';
import { VerificationTokenService } from './verification-token.service';

/** Todo lo relativo al token de verificación: emitir, entregar por correo y consumir (un solo uso, 15 min). */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly uow: UnitOfWork,
    private readonly tokensRepo: OneTimeTokenRepository,
    private readonly users: UserRepository,
    private readonly opaque: OpaqueTokens,
    private readonly tokens: VerificationTokenService,
    private readonly outbox: EmailOutboxService,
  ) {}

  /**
   * Dentro de la transacción del registro: persiste solo el hash del token y deja el correo en la outbox.
   * Devuelve el id del mensaje para enviarlo después del commit.
   */
  async issue(tx: TransactionContext, user: Pick<User, 'id' | 'email' | 'fullName'>): Promise<string> {
    const { rawToken, expiresAt } = await this.tokens.issue(tx, user.id);
    return this.outbox.enqueue(tx, {
      kind: 'email_verification',
      userId: user.id,
      recipientEmail: user.email,
      recipientName: user.fullName,
      rawToken,
      expiresAt,
    });
  }

  /** Tras el commit. Si el envío falla, el mensaje queda en la outbox para reintento; no lanza. */
  deliver(outboxId: string): Promise<void> {
    return this.outbox.dispatch(outboxId);
  }

  async resend(rawEmail: string): Promise<void> {
    try {
      const outboxId = await this.uow.run(async (tx) => {
        const user = await this.users.findByEmailForUpdate(normalizeEmail(rawEmail), tx);
        if (!user || user.emailVerified || user.status !== UserStatus.ACTIVE) return null;

        const purpose = TokenPurpose.EMAIL_VERIFICATION;
        const now = Date.now();
        const latest = await this.tokensRepo.latestCreatedAt(tx, user.id, purpose);
        if (latest && now - latest.getTime() < RESEND_VERIFICATION_COOLDOWN_SECONDS * 1000) return null;

        const since = new Date(now - 24 * 60 * 60 * 1000);
        const count = await this.tokensRepo.countCreatedSince(tx, user.id, purpose, since);
        if (count >= RESEND_VERIFICATION_MAX_PER_DAY) return null;

        await this.tokensRepo.invalidateUnused(tx, user.id, purpose);
        return this.issue(tx, user);
      });
      if (outboxId) await this.deliver(outboxId);
    } catch (error) {
      this.logger.error(`No se pudo procesar el reenvío de verificación: ${error instanceof Error ? error.name : 'Error'}`);
    }
  }

  async verify(rawToken: string): Promise<void> {
    const tokenHash = this.opaque.hash(rawToken);
    await this.uow.run(async (tx) => {
      const purpose = TokenPurpose.EMAIL_VERIFICATION;
      const candidate = await this.tokensRepo.findByHash(tx, tokenHash, purpose);
      // Reenvío y renovación de la outbox bloquean primero al usuario y luego su token.
      if (!candidate || !(await this.users.findByIdForUpdate(candidate.userId, tx))) {
        throw IamErrors.invalidVerificationToken();
      }
      const record = await this.tokensRepo.findByHashForUpdate(tx, tokenHash, purpose);
      if (!record || record.usedAt || record.expiresAt <= new Date()) {
        throw IamErrors.invalidVerificationToken();
      }
      await this.tokensRepo.markUsed(tx, record);
      await this.users.markEmailVerified(tx, record.userId);
    });
  }
}
