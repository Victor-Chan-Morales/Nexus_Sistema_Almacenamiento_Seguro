import { Injectable } from '@nestjs/common';
import { VERIFICATION_TOKEN_TTL_MINUTES } from '../constants';
import { TokenPurpose } from '../domain/enums';
import { addMinutes } from '../iam.utils';
import { OneTimeTokenRepository } from '../ports/repositories';
import { OpaqueTokens } from '../ports/security';
import { TransactionContext } from '../ports/transaction';

/**
 * Emite el token de verificación de correo: un solo uso, 15 minutos, y en la base solo su hash.
 * Lo usan el registro (dentro de su transacción) y el reintento de la outbox (cuando el token
 * anterior venció esperando al proveedor SMTP), sin que esos dos servicios se conozcan entre sí.
 */
@Injectable()
export class VerificationTokenService {
  constructor(
    private readonly tokensRepo: OneTimeTokenRepository,
    private readonly opaque: OpaqueTokens,
  ) {}

  async issue(tx: TransactionContext, userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
    const rawToken = this.opaque.generate();
    const expiresAt = addMinutes(VERIFICATION_TOKEN_TTL_MINUTES);
    await this.tokensRepo.create(tx, {
      userId,
      purpose: TokenPurpose.EMAIL_VERIFICATION,
      tokenHash: this.opaque.hash(rawToken),
      expiresAt,
    });
    return { rawToken, expiresAt };
  }
}
