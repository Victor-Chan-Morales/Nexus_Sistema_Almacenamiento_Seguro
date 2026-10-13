import { Injectable, Logger } from '@nestjs/common';
import { VERIFICATION_TOKEN_TTL_MINUTES } from '../constants';
import { TokenPurpose } from '../domain/enums';
import { User } from '../entities/user.entity';
import { IamErrors } from '../iam.errors';
import { addMinutes } from '../iam.utils';
import { OneTimeTokenRepository, UserRepository } from '../ports/repositories';
import { OpaqueTokens } from '../ports/security';
import { TransactionContext, UnitOfWork } from '../ports/transaction';
import { VerificationMailer } from '../ports/verification-mailer';

/** Todo lo relativo al token de verificación: emitir, entregar por correo y consumir (un solo uso, 15 min). */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly uow: UnitOfWork,
    private readonly tokensRepo: OneTimeTokenRepository,
    private readonly users: UserRepository,
    private readonly opaque: OpaqueTokens,
    private readonly mailer: VerificationMailer,
  ) {}

  /** Persiste solo el hash y devuelve el token en claro, que debe salir únicamente por correo. */
  async issue(tx: TransactionContext, userId: string): Promise<string> {
    const rawToken = this.opaque.generate();
    await this.tokensRepo.create(tx, {
      userId,
      purpose: TokenPurpose.EMAIL_VERIFICATION,
      tokenHash: this.opaque.hash(rawToken),
      expiresAt: addMinutes(VERIFICATION_TOKEN_TTL_MINUTES),
    });
    return rawToken;
  }

  /** Se llama tras el commit. Si el SMTP falla la cuenta ya existe: se registra el error (sin token) y se sigue. */
  async deliver(user: Pick<User, 'id' | 'email' | 'fullName'>, rawToken: string): Promise<void> {
    try {
      await this.mailer.sendVerification(user.email, user.fullName, rawToken);
    } catch (err) {
      this.logger.error(
        `No se pudo enviar el correo de verificación (userId=${user.id}): ${(err as Error).name}`,
      );
    }
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
