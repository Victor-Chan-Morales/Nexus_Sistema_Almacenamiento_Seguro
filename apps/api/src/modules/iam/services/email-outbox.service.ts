import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OutboxCipher } from '../infrastructure/outbox-cipher';
import { EmailOutboxRepository, OutboxMessage } from '../ports/repositories';
import { TransactionContext, UnitOfWork } from '../ports/transaction';
import { VerificationMailer } from '../ports/verification-mailer';
import { VerificationTokenService } from './verification-token.service';

const POLL_INTERVAL_MS = 30_000;
const LEASE_SECONDS = 120;
const BATCH_SIZE = 20;
const MAX_BACKOFF_SECONDS = 30 * 60;
/** Tiempo máximo que se insiste con un mensaje; después se abandona. */
const RETRY_HORIZON_MS = 24 * 60 * 60 * 1000;
/** Si al token le queda menos que esto, se emite uno nuevo antes de enviar. */
const TOKEN_RENEWAL_MARGIN_MS = 60_000;

/**
 * Outbox de correo. El mensaje se escribe dentro de la transacción del registro y se envía después del commit.
 * Si el proveedor falla, el mensaje queda pendiente y el worker lo reintenta con espera creciente durante 24 horas;
 * cuando el token de 15 minutos venció esperando, el reintento emite uno nuevo para que el enlace sirva al llegar.
 * Nunca lanza hacia el registro: la cuenta ya existe aunque el correo no salga todavía.
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
    data: { userId: string; recipientEmail: string; recipientName: string; rawToken: string; expiresAt: Date },
  ): Promise<string> {
    return this.outbox.create(tx, {
      kind: 'email_verification',
      userId: data.userId,
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
    if (this.horizonPassed(message, Date.now())) {
      await this.outbox.markExpired(message.id);
      this.logger.warn(`Mensaje ${message.id} abandonado: 24 h sin poder enviarse`);
      return;
    }

    try {
      const payload = await this.freshPayload(message);
      await this.mailer.sendVerification(message.recipientEmail, message.recipientName, this.cipher.decrypt(payload));
    } catch (err) {
      await this.scheduleRetry(message, (err as Error).name);
      return;
    }
    await this.outbox.markSent(message.id);
  }

  /**
   * Payload a enviar. Si el token venció (o está por vencer) mientras el proveedor estaba caído, se emite
   * uno nuevo y se guarda cifrado: así la cuenta nunca queda creada con un enlace inservible y sin reenvío.
   */
  private async freshPayload(message: OutboxMessage): Promise<string> {
    if (message.expiresAt.getTime() > Date.now() + TOKEN_RENEWAL_MARGIN_MS) {
      return message.encryptedPayload;
    }

    const { rawToken, expiresAt } = await this.uow.run((tx) => this.tokens.issue(tx, message.userId));
    const encryptedPayload = this.cipher.encrypt(rawToken);
    await this.outbox.updatePayload(message.id, { encryptedPayload, expiresAt });
    message.encryptedPayload = encryptedPayload;
    message.expiresAt = expiresAt;
    this.logger.log(`Mensaje ${message.id}: token renovado antes de reintentar el envío`);
    return encryptedPayload;
  }

  private async scheduleRetry(message: OutboxMessage, errorName: string): Promise<void> {
    const attempts = message.attempts + 1;
    const backoffSeconds = Math.min(60 * 2 ** attempts, MAX_BACKOFF_SECONDS);
    const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);

    if (this.horizonPassed(message, nextAttemptAt.getTime())) {
      await this.outbox.markExpired(message.id);
      this.logger.warn(`Mensaje ${message.id} abandonado tras ${attempts} intentos fallidos en 24 h`);
      return;
    }
    await this.outbox.markFailed(message.id, { attempts, nextAttemptAt, lastError: errorName });
    this.logger.error(`Fallo al enviar el mensaje ${message.id} (intento ${attempts}): ${errorName}`);
  }

  private horizonPassed(message: OutboxMessage, at: number): boolean {
    return message.createdAt.getTime() + RETRY_HORIZON_MS <= at;
  }
}
