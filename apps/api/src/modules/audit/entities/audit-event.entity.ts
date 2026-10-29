import { Column, Entity, PrimaryColumn } from 'typeorm';

export enum AuditActorType {
  USER = 'user',
  VISITOR = 'visitor',
  SYSTEM = 'system',
}

export enum AuditResult {
  SUCCESS = 'success',
  FAILURE = 'failure',
}

/** Maps the append-only `audit.audit_event` table. El esquema lo crean las migraciones, no TypeORM. */
@Entity({ schema: 'audit', name: 'audit_event' })
export class AuditEvent {
  /** Sin default: la aplicación genera el UUID. */
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({
    name: 'actor_type',
    type: 'enum',
    enum: AuditActorType,
    enumName: 'actor_type',
  })
  actorType!: AuditActorType;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ name: 'action_type', type: 'varchar', length: 50 })
  actionType!: string;

  @Column({ name: 'resource_type', type: 'varchar', length: 20, nullable: true })
  resourceType!: string | null;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId!: string | null;

  @Column({
    type: 'enum',
    enum: AuditResult,
    enumName: 'event_result',
  })
  result!: AuditResult;

  @Column({ name: 'correlation_id', type: 'uuid' })
  correlationId!: string;

  @Column({ name: 'safe_reason', type: 'varchar', length: 255, nullable: true })
  safeReason!: string | null;

  @Column({ name: 'prev_hash', type: 'varchar', length: 128, nullable: true })
  prevHash!: string | null;

  /** Posición en la cadena de la organización. `bigint` llega como string desde pg. */
  @Column({ name: 'chain_seq', type: 'bigint' })
  chainSeq!: string;

  @Column({ name: 'record_hash', type: 'varchar', length: 128 })
  recordHash!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
}
