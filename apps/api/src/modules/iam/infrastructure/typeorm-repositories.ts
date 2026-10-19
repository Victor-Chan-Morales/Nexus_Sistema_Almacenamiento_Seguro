import { Injectable } from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import {
  DeploymentModel,
  MembershipStatus,
  OrgStatus,
  Role,
  TokenPurpose,
  UserStatus,
} from '../domain/enums';
import { EmailOutbox, OutboxStatus } from '../entities/email-outbox.entity';
import { Membership } from '../entities/membership.entity';
import { OneTimeToken } from '../entities/one-time-token.entity';
import { Organization } from '../entities/organization.entity';
import { IamRole } from '../entities/role.entity';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import {
  EmailOutboxRepository,
  MembershipRepository,
  OneTimeTokenRepository,
  OrganizationRepository,
  OutboxMessage,
  SessionRepository,
  UserRepository,
} from '../ports/repositories';
import { TransactionContext } from '../ports/transaction';

/** Lecturas sin transacción usan el manager por defecto; las escrituras siempre reciben `tx`. */
const managerOf = (dataSource: DataSource, tx?: TransactionContext) => tx ?? dataSource.manager;

@Injectable()
export class TypeOrmUserRepository implements UserRepository {
  constructor(private readonly dataSource: DataSource) {}

  findByEmail(email: string, tx?: TransactionContext): Promise<User | null> {
    return managerOf(this.dataSource, tx).findOne(User, { where: { email } });
  }

  findById(id: string, tx?: TransactionContext): Promise<User | null> {
    return managerOf(this.dataSource, tx).findOne(User, { where: { id } });
  }

  create(
    tx: TransactionContext,
    data: { email: string; fullName: string; passwordHash: string },
  ): Promise<User> {
    return tx.save(
      tx.create(User, {
        ...data,
        emailVerified: false,
        mfaEnabled: false,
        isSuperAdmin: false,
        status: UserStatus.ACTIVE,
      }),
    );
  }

  async markEmailVerified(tx: TransactionContext, userId: string): Promise<void> {
    await tx.update(User, { id: userId }, { emailVerified: true });
  }
}

@Injectable()
export class TypeOrmOrganizationRepository implements OrganizationRepository {
  create(
    tx: TransactionContext,
    data: { name: string; deploymentModel: DeploymentModel },
  ): Promise<Organization> {
    return tx.save(
      tx.create(Organization, {
        name: data.name,
        status: OrgStatus.ACTIVE,
        deploymentModel: data.deploymentModel,
      }),
    );
  }
}

@Injectable()
export class TypeOrmMembershipRepository implements MembershipRepository {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    tx: TransactionContext,
    data: { userId: string; organizationId: string; role: Role },
  ): Promise<Membership> {
    const role = await tx.findOne(IamRole, { where: { name: data.role } });
    if (!role) {
      throw new Error(
        `El catálogo iam.role no contiene el rol "${data.role}": cargar los datos iniciales de roles`,
      );
    }
    return tx.save(
      tx.create(Membership, {
        userId: data.userId,
        organizationId: data.organizationId,
        roleId: role.id,
        status: MembershipStatus.ACTIVE,
      }),
    );
  }

  findActive(
    userId: string,
    organizationId?: string,
    tx?: TransactionContext,
  ): Promise<Membership | null> {
    return managerOf(this.dataSource, tx).findOne(Membership, {
      where: {
        userId,
        status: MembershipStatus.ACTIVE,
        user: { status: UserStatus.ACTIVE },
        organization: { status: OrgStatus.ACTIVE },
        ...(organizationId ? { organizationId } : {}),
      },
      relations: { user: true, organization: true, roleRef: true },
      order: { createdAt: 'ASC' },
    });
  }
}

@Injectable()
export class TypeOrmSessionRepository implements SessionRepository {
  constructor(private readonly dataSource: DataSource) {}

  create(
    tx: TransactionContext,
    data: { userId: string; organizationId: string; refreshTokenHash: string; expiresAt: Date },
  ): Promise<Session> {
    return tx.save(tx.create(Session, { ...data, revokedAt: null }));
  }

  findByRefreshHashForUpdate(tx: TransactionContext, refreshTokenHash: string): Promise<Session | null> {
    return tx.findOne(Session, { where: { refreshTokenHash }, lock: { mode: 'pessimistic_write' } });
  }

  async revoke(tx: TransactionContext, session: Session): Promise<void> {
    await tx.update(Session, { id: session.id }, { revokedAt: () => 'now()' });
    session.revokedAt = new Date();
  }

  async revokeAllActiveOf(tx: TransactionContext, userId: string): Promise<void> {
    await tx.update(Session, { userId, revokedAt: IsNull() }, { revokedAt: () => 'now()' });
  }

  async revokeByRefreshHash(refreshTokenHash: string): Promise<void> {
    await this.dataSource.manager.update(
      Session,
      { refreshTokenHash, revokedAt: IsNull() },
      { revokedAt: () => 'now()' },
    );
  }
}

@Injectable()
export class TypeOrmOneTimeTokenRepository implements OneTimeTokenRepository {
  create(
    tx: TransactionContext,
    data: { userId: string; purpose: TokenPurpose; tokenHash: string; expiresAt: Date },
  ): Promise<OneTimeToken> {
    return tx.save(tx.create(OneTimeToken, { ...data, usedAt: null }));
  }

  findByHashForUpdate(
    tx: TransactionContext,
    tokenHash: string,
    purpose: TokenPurpose,
  ): Promise<OneTimeToken | null> {
    return tx.findOne(OneTimeToken, {
      where: { tokenHash, purpose },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async markUsed(tx: TransactionContext, token: OneTimeToken): Promise<void> {
    await tx.update(OneTimeToken, { id: token.id }, { usedAt: () => 'now()' });
    token.usedAt = new Date();
  }
}

@Injectable()
export class TypeOrmEmailOutboxRepository implements EmailOutboxRepository {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    tx: TransactionContext,
    data: { kind: string; recipientEmail: string; recipientName: string; encryptedPayload: string; expiresAt: Date },
  ): Promise<string> {
    const row = await tx.save(
      tx.create(EmailOutbox, {
        ...data,
        status: OutboxStatus.PENDING,
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        sentAt: null,
      }),
    );
    return row.id;
  }

  async claimDue(
    tx: TransactionContext,
    data: { ids?: string[]; now: Date; leaseUntil: Date; limit: number },
  ): Promise<OutboxMessage[]> {
    const query = tx
      .createQueryBuilder(EmailOutbox, 'o')
      .where('o.status = :pending', { pending: OutboxStatus.PENDING })
      .andWhere('o.nextAttemptAt <= :now', { now: data.now })
      .orderBy('o.nextAttemptAt', 'ASC')
      .limit(data.limit)
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked');
    if (data.ids) query.andWhere('o.id IN (:...ids)', { ids: data.ids });

    const rows = await query.getMany();
    if (rows.length === 0) return [];
    // El arrendamiento evita que otra instancia tome el mismo mensaje mientras se envía.
    await tx.update(EmailOutbox, { id: In(rows.map((row) => row.id)) }, { nextAttemptAt: data.leaseUntil });

    return rows.map((row) => ({
      id: row.id,
      recipientEmail: row.recipientEmail,
      recipientName: row.recipientName,
      encryptedPayload: row.encryptedPayload,
      attempts: row.attempts,
      expiresAt: row.expiresAt,
    }));
  }

  async markSent(id: string): Promise<void> {
    // Se vacía el payload: el token en claro no debe quedar en la base después del envío.
    await this.dataSource.manager.update(
      EmailOutbox,
      { id },
      { status: OutboxStatus.SENT, sentAt: () => 'now()', encryptedPayload: '', lastError: null },
    );
  }

  async markFailed(id: string, data: { attempts: number; nextAttemptAt: Date; lastError: string }): Promise<void> {
    await this.dataSource.manager.update(EmailOutbox, { id }, {
      attempts: data.attempts,
      nextAttemptAt: data.nextAttemptAt,
      lastError: data.lastError,
    });
  }

  async markExpired(id: string): Promise<void> {
    await this.dataSource.manager.update(EmailOutbox, { id }, { status: OutboxStatus.EXPIRED, encryptedPayload: '' });
  }
}
