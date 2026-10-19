import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { OpaqueTokens } from '../ports/security';

@Injectable()
export class CryptoOpaqueTokens implements OpaqueTokens {
  /** 256 bits aleatorios, aptos para URL y cookie. */
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  /** SHA-256 hex: suficiente para tokens de alta entropía (no es una contraseña). */
  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
