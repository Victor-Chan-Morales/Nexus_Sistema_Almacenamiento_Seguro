import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Plan } from './plan.entity';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  SIMULATED = 'simulated', // Para el prototipo universitario
}

@Entity({ name: 'subscription', schema: 'billing' })
export class Subscription {
  @PrimaryGeneratedColumn('uuid', { name: 'subscription_id' })
  id: string;

  /** ID de la organización propietaria de esta suscripción */
  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Plan, { eager: true, nullable: true })
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @Column({ name: 'plan_id' })
  planId: string;

  @Column({ type: 'varchar', default: SubscriptionStatus.SIMULATED })
  status: SubscriptionStatus;

  @Column({ name: 'expires_at', nullable: true, type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', nullable: true })
  updatedAt: Date;
}