import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { IamErrors } from '../iam.errors';
import { AuthUser, JwtPayload } from '../interfaces/auth-user.interface';
import { MembershipRepository } from '../ports/repositories';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly memberships: MembershipRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  /**
   * Se ejecuta con un token ya verificado (firma y expiración). Revalida membresía y organización
   * activas en cada request y toma el rol de la BD: si la cuenta se suspende o cambia de rol, el efecto
   * es inmediato. El resultado es el único tenant que usa el resto de la API.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (!payload?.sub || !payload?.org) throw IamErrors.unauthorized();

    const membership = await this.memberships.findActive(payload.sub, payload.org);
    if (!membership) throw IamErrors.unauthorized();

    return {
      userId: membership.userId,
      organizationId: membership.organizationId,
      role: membership.role,
      email: membership.user.email,
      fullName: membership.user.fullName,
      organizationName: membership.organization.name,
    };
  }
}
