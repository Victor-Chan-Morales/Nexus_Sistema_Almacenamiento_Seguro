import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  ValueTransformer,
} from 'typeorm';
import { Subscription } from './subscription.entity';

export enum BillingOperationType {
  CHARGE = 'charge',
  RENEWAL = 'renewal',
}

const numericToUsd: ValueTransformer = {
  to(value: number | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    return Number(value).toFixed(2);
  },
  from(value: string | number | null): number {
    if (value === null || value === undefined) {
      return 0;
    }
    return Number(value);
  },
};

/** Maps the canonical `billing.billing_operation` table. */
@Entity({ schema: 'billing', name: 'billing_operation' })
export class BillingOperation {
  @PrimaryGeneratedColumn('uuid', { name: 'operation_id' })
  id!: string;

  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId!: string;

  @ManyToOne(() => Subscription)
  @JoinColumn({ name: 'subscription_id', referencedColumnName: 'id' })
  subscription?: Subscription;

  @Column({
    type: 'enum',
    enum: BillingOperationType,
    enumName: 'operation_type',
  })
  type!: BillingOperationType;

  @Column({
    name: 'amount',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: numericToUsd,
  })
  amount!: number;

  @CreateDateColumn({ name: 'simulated_at', type: 'timestamptz' })
  simulatedAt!: Date;

  /** Billing is simulated in this release; the canonical table has no simulated column. */
  simulated = true;
}
