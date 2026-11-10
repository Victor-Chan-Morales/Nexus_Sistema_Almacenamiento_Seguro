import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OutboxKind } from '../constants';
import { OUTBOX_POLL_INTERVAL_MS, outboxBackoffSeconds, outboxHorizonPassed } from '../../../common/outbox-policy';
import { TokenPurpose, UserStatus } from '../domain/enums';
import { OutboxCipher } from '../infrastructure/outbox-cipher';
import { EmailOutboxRepository, OutboxMessage, UserRepository } from '../ports/repositories';
import { TransactionContext, UnitOfWork } from '../ports/transaction';
import { VerificationMailer } from '../ports/verification-mailer';
import { VerificationTokenService } from './verification-token.service';

const LEASE_SECONDS = 120;
const BATCH_SIZE = 20;
/** Si al token le queda menos que esto, se emite uno nuevo antes de enviar. */
const TOKEN_RENEWAL_MARGIN_MS = 60_000;

/**
 * Outbox de enlaces y avisos por correo. El mensaje se envía después del commit de la outbox.
 * Si el proveedor falla, el mensaje queda pendiente
 * y el worker lo reintenta con espera creciente durante 24 horas.
 * Solo `email_verification` renueva un token vencido que no fue consumido ni reemplazado;
 * `password_reset` y `member_invitation` se abandonan al vencer el token y se vuelven a solicitar.
 * Nunca lanza hacia quien encola: la operación de origen ya se confirmó aunque el correo no salga todavía.
 */
@Injectable()
export class EmailOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailOutboxService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly outbox: EmailOutboxRepository,
    private readonly cipher: OutboxCipher,
    private readonly mailer: VerificationMailer,
    private readonly tokens: VerificationTokenService,
    private readonly users: UserRepository,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatchDue(), OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Dentro de la transacción de origen: el mensaje se confirma o revierte junto con ella. */
  enqueue(
    tx: TransactionContext,
    data: {
      kind: OutboxKind;
      userId: string;
      recipientEmail: string;
      recipientName: string;
      rawToken: string;
      expiresAt: Date;
    },
  ): Promise<string> {
    return this.outbox.create(tx, {
      kind: data.kind,
      userId: data.userId,
      recipientEmail: data.recipientEmail,
      recipientName: data.recipientName,
      encryptedPayload: this.cipher.encrypt(data.rawToken),
      expiresAt: data.expiresAt,
    });
  }

  /**
   * Dentro de la transacción de origen: emite el token de un solo uso (solo su hash se guarda) y encola el
   * correo con su vigencia. Lo usan la recuperación de contraseña y el alta de miembros.
   */
  async enqueueWithToken(
    tx: TransactionContext,
    data: {
      kind: OutboxKind;
      userId: string;
      recipientEmail: string;
      recipientName: string;
      purpose: TokenPurpose;
      ttlMinutes: number;
    },
  ): Promise<string> {
    const { rawToken, expiresAt } = await this.tokens.issueFor(tx, data.userId, data.purpose, data.ttlMinutes);
    return this.enqueue(tx, {
      kind: data.kind,
      userId: data.userId,
      recipientEmail: data.recipientEmail,
      recipientName: data.recipientName,
      rawToken,
      expiresAt,
    });
  }

  /** Envía un mensaje concreto tras el commit. */
  dispatch(id: string): Promise<void> {
    return this.processDue({ ids: [id] });
  }

  /** Reintenta los mensajes pendientes cuyo momento de reintento ya llegó. */
  dispatchDue(): Promise<void> {
    return this.processDue({});
  }

  private async processDue(filter: { ids?: string[] }): Promise<void> {
    const now = new Date();
    let messages: OutboxMessage[];
    try {
      messages = await this.uow.run((tx) =>
        this.outbox.claimDue(tx, {
          ...filter,
          now,
          leaseUntil: new Date(now.getTime() + LEASE_SECONDS * 1000),
          limit: BATCH_SIZE,
        }),
      );
    } catch (err) {
      this.logger.error(`No se pudieron reclamar mensajes de correo: ${(err as Error).name}`);
      return;
    }

    for (const message of messages) {
      try {
        await this.send(message);
      } catch (err) {
        this.logger.error(`Error al procesar el mensaje ${message.id}: ${(err as Error).name}`);
      }
    }
  }

  private async send(message: OutboxMessage): Promise<void> {
    if (outboxHorizonPassed(message.createdAt, Date.now())) {
      await this.outbox.markExpired(message.id);
      this.logger.warn(`Mensaje ${message.id} abandonado: 24 h sin poder enviarse`);
      return;
    }

    if (message.kind !== 'email_verification' && message.expiresAt.getTime() <= Date.now()) {
      await this.outbox.markExpired(message.id);
      this.logger.warn(`Mensaje ${message.id} (${message.kind}) abandonado: venció sin enviarse`);
      return;
    }

    try {
      const token = await this.deliveryToken(message);
      if (token === null) {
        await this.outbox.markExpired(message.id, message.encryptedPayload);
        return;
      }
      await this.deliver(message, token);
    } catch (err) {
      await this.scheduleRetry(message, (err as Error).name);
      return;
    }
    await this.outbox.markSent(message.id);
  }

  private deliver(message: OutboxMessage, token: string): Promise<void> {
    switch (message.kind) {
      case 'email_verification':
        return this.mailer.sendVerification(message.recipientEmail, message.recipientName, token);
      case 'password_reset':
        return this.mailer.sendPasswordReset(message.recipientEmail, message.recipientName, token);
      case 'member_invitation':
        return this.mailer.sendMemberInvitation(message.recipientEmail, message.recipientName, token);
      case 'plan_changed':
      case 'member_status_changed':
      case 'organization_closed':
        return this.mailer.sendAccountNotice(message.recipientEmail, message.kind);
      default:
        throw new Error(`UnknownOutboxKind`);
    }
  }

  private async deliveryToken(message: OutboxMessage): Promise<string | null> {
    const rawToken = this.cipher.decrypt(message.encryptedPayload);
    if (message.kind !== 'email_verification') return rawToken;

    return this.uow.run(async (tx) => {
      const user = await this.users.findByIdForUpdate(message.userId, tx);
      if (!user || user.emailVerified || user.status !== UserStatus.ACTIVE) return null;

      const token = await this.tokens.findForUpdate(tx, rawToken);
      if (!token || token.userId !== user.id || token.usedAt) return null;
      const expiresAt = Math.min(token.expiresAt.getTime(), message.expiresAt.getTime());
      if (expiresAt > Date.now() + TOKEN_RENEWAL_MARGIN_MS) return rawToken;

      const replacement = await this.tokens.replace(tx, token);
      const encryptedPayload = this.cipher.encrypt(replacement.rawToken);
      await this.outbox.updatePayload(message.id, { encryptedPayload, expiresAt: replacement.expiresAt }, tx);
      return replacement.rawToken;
    });
  }

  private async scheduleRetry(message: OutboxMessage, errorName: string): Promise<void> {
    const attempts = message.attempts + 1;
    const backoffSeconds = outboxBackoffSeconds(attempts);
    const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);

    if (outboxHorizonPassed(message.createdAt, nextAttemptAt.getTime())) {
      await this.outbox.markExpired(message.id);
      this.logger.warn(`Mensaje ${message.id} abandonado tras ${attempts} intentos fallidos en 24 h`);
      return;
    }
    await this.outbox.markFailed(message.id, { attempts, nextAttemptAt, lastError: errorName });
    this.logger.error(`Fallo al enviar el mensaje ${message.id} (intento ${attempts}): ${errorName}`);
  }
}
