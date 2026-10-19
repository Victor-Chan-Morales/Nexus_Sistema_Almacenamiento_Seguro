import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum OutboxStatus {
  PENDING = 'pending',
  SENT = 'sent',
  EXPIRED = 'expired',
}

/**
 * Tabla iam.email_outbox. Mensaje de correo persistido dentro de la transacción de registro y enviado
 * después del commit; los fallos temporales se reintentan desde aquí.
 */
@Entity({ schema: 'iam', name: 'email_outbox' })
export class EmailOutbox {
  @PrimaryGeneratedColumn('uuid', { name: 'outbox_id' })
  id!: string;

  @Column({ type: 'varchar', length: 40 })
  kind!: string;

  @Column({ name: 'recipient_email', type: 'varchar', length: 255 })
  recipientEmail!: string;

  @Column({ name: 'recipient_name', type: 'varchar', length: 255 })
  recipientName!: string;

  /** Token en claro cifrado. Se vacía cuando el mensaje se envía o vence. */
  @Column({ name: 'encrypted_payload', type: 'text' })
  encryptedPayload!: string;

  @Column({ type: 'varchar', length: 20, default: OutboxStatus.PENDING })
  status!: OutboxStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt!: Date;

  /** Vencimiento del token: después de esta hora el enlace ya no sirve y no se envía. */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /** Solo el nombre del error, nunca el mensaje del proveedor ni el token. */
  @Column({ name: 'last_error', type: 'varchar', length: 100, nullable: true })
  lastError!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;
}
