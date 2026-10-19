import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  ValueTransformer,
} from 'typeorm';
import { Plan } from './plan.entity';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

const dateOnly: ValueTransformer = {
  to(value: Date | null | undefined): string | null | undefined {
    return value instanceof Date ? value.toISOString().slice(0, 10) : value;
  },
  from(value: string | null): Date | null {
    return value ? new Date(`${value}T00:00:00.000Z`) : null;
  },
};

/** Maps the public Billing model onto the canonical `billing.subscription` table. */
@Entity({ schema: 'billing', name: 'subscription' })
@Index('uq_subscription_one_active_per_organization', ['organizationId'], {
  unique: true,
  where: "status = 'active'",
})
export class Subscription {
  @PrimaryGeneratedColumn('uuid', { name: 'subscription_id' })
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Plan, { eager: true })
  @JoinColumn({ name: 'plan_id', referencedColumnName: 'id' })
  plan!: Plan;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    enumName: 'subscription_status',
  })
  status!: SubscriptionStatus;

  @Column({ name: 'start_date', type: 'date', transformer: dateOnly })
  startDate?: Date;

  /** `end_date` is exclusive: on that UTC date the subscription is already expired. */
  @Column({ name: 'end_date', type: 'date', nullable: true, transformer: dateOnly })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** Billing is simulated in this release; the canonical schema has no payment column. */
  simulated = true;
  updatedAt?: Date;
}
