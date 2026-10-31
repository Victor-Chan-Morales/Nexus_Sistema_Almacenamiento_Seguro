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
  /** Como findByEmail, pero bloquea la fila del usuario hasta el fin de la transacción (SELECT ... FOR UPDATE). */
  abstract findByEmailForUpdate(email: string, tx: TransactionContext): Promise<User | null>;
  abstract findById(id: string, tx?: TransactionContext): Promise<User | null>;
  abstract create(
    tx: TransactionContext,
    data: { email: string; fullName: string; passwordHash: string },
  ): Promise<User>;
  abstract markEmailVerified(tx: TransactionContext, userId: string): Promise<void>;
  /** Restablecimiento: reemplaza el hash y deja email_verified = true (el enlace prueba que controla el buzón). */
  abstract setPasswordAndVerifyEmail(tx: TransactionContext, userId: string, passwordHash: string): Promise<void>;
}

export abstract class OrganizationRepository {
  abstract create(
    tx: TransactionContext,
    data: { name: string; deploymentModel: DeploymentModel },
  ): Promise<Organization>;

  /**
   * Bloquea la fila de la organización (SELECT ... FOR UPDATE) hasta el fin de la transacción. Serializa las
   * altas de miembros de una misma organización. Devuelve false si la organización no existe.
   */
  abstract lockById(tx: TransactionContext, organizationId: string): Promise<boolean>;
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

  /**
   * Miembros de una organización (cualquier estado) con el nombre y el correo del usuario y el nombre del rol,
   * del más antiguo al más nuevo. Solo carga las columnas necesarias: nunca el hash de la contraseña.
   */
  abstract listByOrganization(organizationId: string): Promise<Membership[]>;

  /** Ids de TODAS las organizaciones donde el usuario tiene membresía (cualquier estado). */
  abstract organizationIdsOfUser(tx: TransactionContext, userId: string): Promise<string[]>;

  /** Membresías con status = active de una organización (base del límite de usuarios del plan). */
  abstract countActiveInOrganization(tx: TransactionContext, organizationId: string): Promise<number>;
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
  /** Deja inválidos (used_at = now()) los tokens sin usar de un usuario para ese propósito. */
  abstract invalidateUnused(tx: TransactionContext, userId: string, purpose: TokenPurpose): Promise<void>;
}

/** Mensaje reclamado para envío: el token sigue cifrado hasta el momento de enviarlo. */
export interface OutboxMessage {
  id: string;
  kind: string;
  userId: string;
  recipientEmail: string;
  recipientName: string;
  encryptedPayload: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

/** Outbox de correo. El servicio decide cuándo reclamar, enviar y marcar; aquí solo hay persistencia. */
export abstract class EmailOutboxRepository {
  abstract create(
    tx: TransactionContext,
    data: {
      kind: string;
      userId: string;
      recipientEmail: string;
      recipientName: string;
      encryptedPayload: string;
      expiresAt: Date;
    },
  ): Promise<string>;
  /** Reclama mensajes pendientes y vencidos para reintento con bloqueo (SKIP LOCKED) hasta `leaseUntil`. */
  abstract claimDue(
    tx: TransactionContext,
    data: { ids?: string[]; now: Date; leaseUntil: Date; limit: number },
  ): Promise<OutboxMessage[]>;
  /** Reemplaza el token cifrado y su vencimiento cuando el reintento emite un token nuevo. */
  abstract updatePayload(id: string, data: { encryptedPayload: string; expiresAt: Date }): Promise<void>;
  abstract markSent(id: string): Promise<void>;
  abstract markFailed(
    id: string,
    data: { attempts: number; nextAttemptAt: Date; lastError: string },
  ): Promise<void>;
  abstract markExpired(id: string): Promise<void>;
}
