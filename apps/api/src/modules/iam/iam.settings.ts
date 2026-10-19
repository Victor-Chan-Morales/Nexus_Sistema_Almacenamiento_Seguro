import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Única lectura de configuración de políticas de IAM (los servicios no leen variables de entorno). */
@Injectable()
export class IamSettings {
  constructor(private readonly config: ConfigService) {}

  /** Decisión de contrato propuesta: por defecto el login exige correo verificado. */
  get requireVerifiedEmail(): boolean {
    return this.config.get<string>('IAM_REQUIRE_VERIFIED_EMAIL') !== 'false';
  }

  get refreshCookie(): { secure: boolean; sameSite: 'lax' | 'strict' | 'none' } {
    const secure =
      (this.config.get<string>('COOKIE_SECURE') ?? String(process.env.NODE_ENV === 'production')) === 'true';
    const sameSite = (this.config.get<string>('COOKIE_SAMESITE') ?? 'lax') as 'lax' | 'strict' | 'none';
    return { secure, sameSite };
  }
}
