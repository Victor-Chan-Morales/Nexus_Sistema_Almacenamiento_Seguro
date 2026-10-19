import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OutboxCipher } from '../infrastructure/outbox-cipher';
import { EmailOutboxRepository, OutboxMessage } from '../ports/repositories';
import { TransactionContext, UnitOfWork } from '../ports/transaction';
import { VerificationMailer } from '../ports/verification-mailer';

const POLL_INTERVAL_MS = 30_000;
const LEASE_SECONDS = 120;
const BATCH_SIZE = 20;
const MAX_BACKOFF_SECONDS = 30 * 60;

/**
 * Outbox de correo. El mensaje se escribe dentro de la transacción del registro y se envía después del commit.
 * Si el proveedor falla, el mensaje queda pendiente y el worker lo reintenta con espera creciente hasta que
 * el token venza. Nunca lanza hacia el registro: la cuenta ya existe aunque el correo no salga todavía.
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
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatchDue(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Dentro de la transacción del registro: el mensaje se confirma o revierte junto con la cuenta. */
  enqueueVerification(
    tx: TransactionContext,
    data: { recipientEmail: string; recipientName: string; rawToken: string; expiresAt: Date },
  ): Promise<string> {
    return this.outbox.create(tx, {
      kind: 'email_verification',
      recipientEmail: data.recipientEmail,
      recipientName: data.recipientName,
      encryptedPayload: this.cipher.encrypt(data.rawToken),
      expiresAt: data.expiresAt,
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
    if (message.expiresAt.getTime() <= Date.now()) {
      await this.outbox.markExpired(message.id);
      this.logger.warn(`Mensaje ${message.id} vencido antes de enviarse`);
      return;
    }

    try {
      const token = this.cipher.decrypt(message.encryptedPayload);
      await this.mailer.sendVerification(message.recipientEmail, message.recipientName, token);
    } catch (err) {
      await this.scheduleRetry(message, (err as Error).name);
      return;
    }
    await this.outbox.markSent(message.id);
  }

  private async scheduleRetry(message: OutboxMessage, errorName: string): Promise<void> {
    const attempts = message.attempts + 1;
    const backoffSeconds = Math.min(60 * 2 ** attempts, MAX_BACKOFF_SECONDS);
    const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);

    if (nextAttemptAt >= message.expiresAt) {
      await this.outbox.markExpired(message.id);
      this.logger.warn(`Mensaje ${message.id} vencido tras ${attempts} intentos fallidos`);
      return;
    }
    await this.outbox.markFailed(message.id, { attempts, nextAttemptAt, lastError: errorName });
    this.logger.error(`Fallo al enviar el mensaje ${message.id} (intento ${attempts}): ${errorName}`);
  }
}
