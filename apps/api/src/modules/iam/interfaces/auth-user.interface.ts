import { Role } from '../domain/enums';

/** Claims del access token. El rol NO se confía del token: se relee de la membresía. */
export interface JwtPayload {
  sub: string; // userId
  org: string; // organizationId activo
  role: string;
  iat?: number;
  exp?: number;
}

/**
 * Lo que queda en req.user y entrega @CurrentUser(). Siempre derivado del backend
 * (JWT + membresía activa revalidada en cada request).
 */
export interface AuthUser {
  userId: string;
  organizationId: string;
  role: Role;
  email: string;
  fullName: string;
  organizationName: string;
}

/** CONTRACTS.md v0.2 · POST /auth/login (y refresh): fechas ISO-8601 UTC. */
export interface LoginResponse {
  accessToken: string;
  expiresAt: string;
  user: { id: string; fullName: string; email: string };
  organization: { id: string; name: string };
  role: string;
}

/** CONTRACTS.md v0.2 · POST /auth/register */
export interface RegisterResponse {
  userId: string;
  organizationId: string;
  role: string;
  verificationRequired: boolean;
}

/** CONTRACTS.md v0.2 · GET /auth/me → { user, organization, role } */
export interface MeResponse {
  user: { id: string; fullName: string; email: string };
  organization: { id: string; name: string };
  role: string;
}
