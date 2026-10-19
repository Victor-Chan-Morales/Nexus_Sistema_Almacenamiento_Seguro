import { Injectable } from '@nestjs/common';
import { TokenPurpose } from '../domain/enums';
import { User } from '../entities/user.entity';
import { IamErrors } from '../iam.errors';
import { OneTimeTokenRepository, UserRepository } from '../ports/repositories';
import { OpaqueTokens } from '../ports/security';
import { TransactionContext, UnitOfWork } from '../ports/transaction';
import { EmailOutboxService } from './email-outbox.service';
import { VerificationTokenService } from './verification-token.service';

/** Todo lo relativo al token de verificación: emitir, entregar por correo y consumir (un solo uso, 15 min). */
@Injectable()
export class EmailVerificationService {
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
    return this.outbox.enqueueVerification(tx, {
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

  async verify(rawToken: string): Promise<void> {
    const tokenHash = this.opaque.hash(rawToken);
    await this.uow.run(async (tx) => {
      // El filtro por propósito evita que un token de restablecer contraseña verifique un correo.
      const record = await this.tokensRepo.findByHashForUpdate(tx, tokenHash, TokenPurpose.EMAIL_VERIFICATION);
      if (!record || record.usedAt || record.expiresAt <= new Date()) {
        throw IamErrors.invalidVerificationToken();
      }
      await this.tokensRepo.markUsed(tx, record);
      await this.users.markEmailVerified(tx, record.userId);
    });
  }
}
