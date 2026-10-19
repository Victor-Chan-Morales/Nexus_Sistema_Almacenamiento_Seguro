/** Algoritmo de hash de contraseñas (hoy Argon2id). Cambiarlo no toca los casos de uso. */
export abstract class PasswordHasher {
  abstract hash(plain: string): Promise<string>;
  /** Nunca lanza: un hash ilegible o una contraseña incorrecta devuelven false. */
  abstract verify(hash: string, plain: string): Promise<boolean>;
}

export interface AccessTokenClaims {
  sub: string; // userId
  org: string; // organizationId activo
  role: string;
}

/** Emisión del access token (hoy JWT HS256 de 15 minutos). */
export abstract class AccessTokenIssuer {
  abstract issue(claims: AccessTokenClaims): Promise<{ token: string; expiresAt: string }>;
}

/** Tokens opacos aleatorios (refresh y verificación): se generan en claro y solo se persiste su hash. */
export abstract class OpaqueTokens {
  abstract generate(): string;
  abstract hash(token: string): string;
}
