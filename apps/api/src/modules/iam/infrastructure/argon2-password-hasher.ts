import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PasswordHasher } from '../ports/security';

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    // Parámetros mínimos recomendados por OWASP para Argon2id (memoryCost en KiB).
    // Las opciones van en línea a propósito: así no dependen del nombre del tipo de opciones, que cambió
    // entre versiones de `argon2`, y TypeScript elige la sobrecarga que devuelve string.
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
