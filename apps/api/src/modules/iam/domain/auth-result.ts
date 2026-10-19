import { Session } from '../entities/session.entity';
import { Role } from './enums';

/**
 * Resultado de autenticar o refrescar (diagrama: AuthService.authenticate(...) → Session).
 * `session` es la fila persistida (solo guarda el hash del refresh token);
 * `refreshToken` es el valor en claro y solo debe salir como cookie HttpOnly.
 */
export interface AuthResult {
  session: Session;
  refreshToken: string;
  accessToken: string;
  /** ISO-8601 UTC, tomado del claim exp del access token. */
  expiresAt: string;
  user: { id: string; fullName: string; email: string };
  organization: { id: string; name: string };
  role: Role;
}
