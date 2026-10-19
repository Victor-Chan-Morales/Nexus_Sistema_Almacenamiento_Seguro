import { DeploymentModel, Role, TokenPurpose } from '../domain/enums';
import { Membership } from '../entities/membership.entity';
import { OneTimeToken } from '../entities/one-time-token.entity';
import { Organization } from '../entities/organization.entity';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import { TransactionContext } from './transaction';

/**
 * Puertos de persistencia de IAM. Sustituyen en el monolito al DatabaseServiceClient del diagrama
 * (findUserByEmail, createMembership, ...), pero divididos por agregado (ISP): cada servicio
 * depende solo de lo que usa. Son clases abstractas para poder usarlas como token de inyección.
 */
export abstract class UserRepository {
  abstract findByEmail(email: string, tx?: TransactionContext): Promise<User | null>;
  abstract findById(id: string, tx?: TransactionContext): Promise<User | null>;
  abstract create(
    tx: TransactionContext,
    data: { email: string; fullName: string; passwordHash: string },
  ): Promise<User>;
  abstract markEmailVerified(tx: TransactionContext, userId: string): Promise<void>;
}

export abstract class OrganizationRepository {
  abstract create(
    tx: TransactionContext,
    data: { name: string; deploymentModel: DeploymentModel },
  ): Promise<Organization>;
}

export abstract class MembershipRepository {
  /** Resuelve el rol en el catálogo iam.role; falla con un mensaje claro si el catálogo no lo tiene. */
  abstract create(
    tx: TransactionContext,
    data: { userId: string; organizationId: string; role: Role },
  ): Promise<Membership>;

  /**
   * Membresía ACTIVA de un usuario ACTIVO en una organización ACTIVA, con `user`, `organization` y
   * `roleRef` cargados. Sin organizationId devuelve la más antigua (selector de organización: pendiente).
   */
  abstract findActive(
    userId: string,
    organizationId?: string,
    tx?: TransactionContext,
  ): Promise<Membership | null>;
}

/** Las revocaciones usan la hora de la BD (now()) para respetar los CHECK de iam.session. */
export abstract class SessionRepository {
  abstract create(
    tx: TransactionContext,
    data: { userId: string; organizationId: string; refreshTokenHash: string; expiresAt: Date },
  ): Promise<Session>;
  abstract findByRefreshHashForUpdate(
    tx: TransactionContext,
    refreshTokenHash: string,
  ): Promise<Session | null>;
  abstract revoke(tx: TransactionContext, session: Session): Promise<void>;
  abstract revokeAllActiveOf(tx: TransactionContext, userId: string): Promise<void>;
  abstract revokeByRefreshHash(refreshTokenHash: string): Promise<void>;
}

/** Tokens de un solo uso (hoy verificación de correo; mañana también restablecer contraseña). */
export abstract class OneTimeTokenRepository {
  abstract create(
    tx: TransactionContext,
    data: { userId: string; purpose: TokenPurpose; tokenHash: string; expiresAt: Date },
  ): Promise<OneTimeToken>;
  abstract findByHashForUpdate(
    tx: TransactionContext,
    tokenHash: string,
    purpose: TokenPurpose,
  ): Promise<OneTimeToken | null>;
  abstract markUsed(tx: TransactionContext, token: OneTimeToken): Promise<void>;
}

/** Mensaje reclamado para envío: el token sigue cifrado hasta el momento de enviarlo. */
export interface OutboxMessage {
  id: string;
  recipientEmail: string;
  recipientName: string;
  encryptedPayload: string;
  attempts: number;
  expiresAt: Date;
}

/** Outbox de correo. El servicio decide cuándo reclamar, enviar y marcar; aquí solo hay persistencia. */
export abstract class EmailOutboxRepository {
  abstract create(
    tx: TransactionContext,
    data: { kind: string; recipientEmail: string; recipientName: string; encryptedPayload: string; expiresAt: Date },
  ): Promise<string>;
  /** Reclama mensajes pendientes y vencidos para reintento con bloqueo (SKIP LOCKED) hasta `leaseUntil`. */
  abstract claimDue(
    tx: TransactionContext,
    data: { ids?: string[]; now: Date; leaseUntil: Date; limit: number },
  ): Promise<OutboxMessage[]>;
  abstract markSent(id: string): Promise<void>;
  abstract markFailed(
    id: string,
    data: { attempts: number; nextAttemptAt: Date; lastError: string },
  ): Promise<void>;
  abstract markExpired(id: string): Promise<void>;
}
