import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum StorageLocation {
  CLOUD = 'cloud',
  ON_PREMISES = 'on_premises',
  HYBRID = 'hybrid',
}

@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ nullable: true, type: 'text' })
  description?: string;

  /** Precio en centavos (0 = gratuito / simulado) */
  @Column({ name: 'price_cents', default: 0 })
  priceCents: number;

  /** Cuota de almacenamiento en bytes */
  @Column({ name: 'storage_limit_bytes', type: 'bigint' })
  storageLimitBytes: string;

  @Column({ name: 'max_members', default: 5 })
  maxMembers: number;

  /** Días de vigencia. null indica que el plan no tiene vencimiento (ej. Plan Demo) */
  @Column({ name: 'validity_days', type: 'int', nullable: true, default: null })
  validityDays: number | null;

  @Column({ type: 'varchar', default: StorageLocation.CLOUD })
  storageLocation: StorageLocation;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
