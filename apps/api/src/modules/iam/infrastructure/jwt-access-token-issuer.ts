import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_TTL_SECONDS } from '../constants';
import { AccessTokenClaims, AccessTokenIssuer } from '../ports/security';

@Injectable()
export class JwtAccessTokenIssuer implements AccessTokenIssuer {
  constructor(private readonly jwt: JwtService) {}

  /** Devuelve el JWT y su vencimiento exacto (claim exp) en ISO-8601 UTC. */
  async issue(claims: AccessTokenClaims): Promise<{ token: string; expiresAt: string }> {
    const token = await this.jwt.signAsync(claims, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
    const { exp } = this.jwt.decode<{ exp: number }>(token);
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }
}
