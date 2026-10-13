import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

/**
 * Estrategia JWT para Passport.
 * Lee el token del header Authorization: Bearer <token>
 * y lo valida automáticamente en todos los endpoints protegidos.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'dev-secret-cambia-esto'),
    });
  }

  /** El payload ya fue verificado por Passport; devolvemos el usuario del request */
  async validate(payload: { sub: string; email: string; organizationId?: string; role?: string }) {
    return {
      userId: payload.sub,
      email: payload.email,
      organizationId: payload.organizationId,
      role: payload.role,
    };
  }
}
