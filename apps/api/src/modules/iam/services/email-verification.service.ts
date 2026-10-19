import { Injectable } from '@nestjs/common';
import { VERIFICATION_TOKEN_TTL_MINUTES } from '../constants';
import { TokenPurpose } from '../domain/enums';
import { User } from '../entities/user.entity';
import { IamErrors } from '../iam.errors';
import { addMinutes } from '../iam.utils';
import { OneTimeTokenRepository, UserRepository } from '../ports/repositories';
import { OpaqueTokens } from '../ports/security';
import { TransactionContext, UnitOfWork } from '../ports/transaction';
import { EmailOutboxService } from './email-outbox.service';

/** Todo lo relativo al token de verificación: emitir, entregar por correo y consumir (un solo uso, 15 min). */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tokensRepo: OneTimeTokenRepository,
    private readonly users: UserRepository,
    private readonly opaque: OpaqueTokens,
    private readonly outbox: EmailOutboxService,
  ) {}

  /**
   * Dentro de la transacción del registro: persiste solo el hash del token y deja el correo en la outbox.
   * Devuelve el id del mensaje para enviarlo después del commit.
   */
  async issue(tx: TransactionContext, user: Pick<User, 'id' | 'email' | 'fullName'>): Promise<string> {
    const rawToken = this.opaque.generate();
    const expiresAt = addMinutes(VERIFICATION_TOKEN_TTL_MINUTES);
    await this.tokensRepo.create(tx, {
      userId: user.id,
      purpose: TokenPurpose.EMAIL_VERIFICATION,
      tokenHash: this.opaque.hash(rawToken),
      expiresAt,
    });
    return this.outbox.enqueueVerification(tx, {
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
