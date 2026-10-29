import { Column, Entity, PrimaryColumn } from 'typeorm';

export enum AuditOutboxStatus {
  PENDING = 'pending',
  DEAD = 'dead',
}

/**
 * Tabla audit.audit_outbox. Evento que no pudo registrarse en la cadena y se reintenta desde aquí.
 * El esquema lo crean las migraciones, no TypeORM.
 */
@Entity({ schema: 'audit', name: 'audit_outbox' })
export class AuditOutbox {
  /** Mismo event_id que el evento original: la PK impide encolarlo dos veces. */
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId!: string;

  @Column({ name: 'action_type', type: 'varchar', length: 50 })
  actionType!: string;

  @Column({ name: 'resource_type', type: 'varchar', length: 20, nullable: true })
  resourceType!: string | null;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId!: string | null;

  @Column({ name: 'correlation_id', type: 'uuid' })
  correlationId!: string;

  /** Momento de captura del evento original, fijado antes del intento directo. */
  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ type: 'varchar', length: 20, default: AuditOutboxStatus.PENDING })
  status!: AuditOutboxStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt!: Date;

  /** Solo el código del error, nunca el mensaje del motor ni datos del evento. */
  @Column({ name: 'last_error', type: 'varchar', length: 100, nullable: true })
  lastError!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
