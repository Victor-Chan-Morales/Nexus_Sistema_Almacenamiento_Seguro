import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ValueTransformer,
} from 'typeorm';

export enum StorageLocation {
  CLOUD = 'cloud',
  ON_PREMISES = 'on_premises',
  HYBRID = 'hybrid',
}

const bytesToGigabytes: ValueTransformer = {
  to(value: string | bigint): number {
    const bytes = BigInt(value);
    const bytesPerGigabyte = 1_000_000_000n;
    if (bytes % bytesPerGigabyte !== 0n) {
      throw new Error('storageLimitBytes debe expresarse en GB decimales completos');
    }
    return Number(bytes / bytesPerGigabyte);
  },
  from(value: number): string {
    return (BigInt(value) * 1_000_000_000n).toString();
  },
};

const centsToMonthlyPrice: ValueTransformer = {
  to(value: number): string {
    return (value / 100).toFixed(2);
  },
  from(value: string | number): number {
    return Math.round(Number(value) * 100);
  },
};

/** Maps the public Billing model onto the canonical `billing.plan` table. */
@Entity({ schema: 'billing', name: 'plan' })
export class Plan {
  @PrimaryGeneratedColumn('uuid', { name: 'plan_id' })
  id!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  /** The canonical table stores USD as numeric(10,2); the service keeps cents. */
  @Column({
    name: 'price_monthly',
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: centsToMonthlyPrice,
  })
  priceCents!: number;

  /** The canonical table stores decimal GB; the API and other modules use bytes. */
  @Column({ name: 'storage_limit_gb', type: 'integer', transformer: bytesToGigabytes })
  storageLimitBytes!: string;

  @Column({ name: 'user_limit', type: 'integer' })
  maxMembers!: number;

  @Column({ name: 'validity_days', type: 'integer', nullable: true })
  validityDays!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** The current catalog is active and cloud-hosted; neither is a persisted column. */
  active = true;
  storageLocation = StorageLocation.CLOUD;
}
