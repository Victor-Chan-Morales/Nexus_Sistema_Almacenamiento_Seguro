import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Plan } from './plan.entity';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

@Entity('subscriptions')
@Index('uq_active_org_subscription', ['organizationId'], {
  unique: true,
  where: "status = 'active'",
})
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** ID de la organización propietaria de esta suscripción */
  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Plan, { eager: true })
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @Column({ name: 'plan_id' })
  planId: string;

  /** Estado de vigencia real de la suscripción (active, expired, cancelled) */
  @Column({ type: 'varchar', default: SubscriptionStatus.ACTIVE })
  status: SubscriptionStatus;

  /** Indicador de si la suscripción es simulada (sin procesamiento de pago real) */
  @Column({ default: true })
  simulated: boolean;

  /** Fecha de vencimiento. null indica sin vencimiento (ej. Plan Demo) */
  @Column({ name: 'expires_at', nullable: true, type: 'timestamptz' })
  expiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
