import { Injectable, Logger } from '@nestjs/common';
import type { AccountNoticeKind } from '../constants';
import { MembershipStatus, Role, UserStatus } from '../domain/enums';
import { MembershipRepository } from '../ports/repositories';
import { TransactionContext, UnitOfWork } from '../ports/transaction';
import { EmailOutboxService } from './email-outbox.service';

export interface AccountNoticeRecipient {
  userId: string;
  email: string;
}

const NOTICE_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AccountNotices {
  private readonly logger = new Logger(AccountNotices.name);

  constructor(
    private readonly memberships: MembershipRepository,
    private readonly uow: UnitOfWork,
    private readonly outbox: EmailOutboxService,
  ) {}

  async planChanged(organizationId: string): Promise<void> {
    try {
      const members = await this.memberships.listByOrganization(organizationId);
      await this.enqueue('plan_changed', members.filter((member) =>
        member.role === Role.TENANT_ADMIN &&
        member.status === MembershipStatus.ACTIVE &&
        member.user.status === UserStatus.ACTIVE,
      ).map((member) => ({ userId: member.userId, email: member.user.email })));
    } catch {
      this.logger.warn('No se pudieron resolver los destinatarios del aviso de suscripción');
    }
  }

  memberStatusChanged(recipient: AccountNoticeRecipient): Promise<void> {
    return this.enqueue('member_status_changed', [recipient]);
  }

  async captureClosureRecipients(tx: TransactionContext, organizationId: string): Promise<AccountNoticeRecipient[]> {
    try {
      // El savepoint aísla un error de lectura sin invalidar la transacción del cierre.
      const members = await tx.transaction((savepoint) => this.memberships.listByOrganization(organizationId, savepoint));
      return members.filter((member) =>
        member.status === MembershipStatus.ACTIVE && member.user.status === UserStatus.ACTIVE,
      ).map((member) => ({ userId: member.userId, email: member.user.email }));
    } catch {
      this.logger.warn('No se pudieron resolver los destinatarios del aviso de cierre');
      return [];
    }
  }

  organizationClosed(recipients: AccountNoticeRecipient[]): Promise<void> {
    return this.enqueue('organization_closed', recipients);
  }

  private async enqueue(kind: AccountNoticeKind, recipients: AccountNoticeRecipient[]): Promise<void> {
    if (!recipients.length) return;

    try {
      const expiresAt = new Date(Date.now() + NOTICE_TTL_MS);
      // Se confirma en una transacción propia. El worker entrega y reintenta fuera de la solicitud.
      await this.uow.run(async (tx) => {
        for (const recipient of recipients) {
          await this.outbox.enqueue(tx, {
            kind,
            userId: recipient.userId,
            recipientEmail: recipient.email,
            recipientName: '',
            rawToken: '',
            expiresAt,
          });
        }
      });
    } catch {
      this.logger.warn(`No se pudo encolar el aviso ${kind}`);
    }
  }
}
