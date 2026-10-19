import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'files', name: 'tenant_encryption_key' })
export class TenantEncryptionKey {
  @PrimaryGeneratedColumn('uuid', { name: 'key_id' })
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'external_reference', type: 'varchar', length: 500 })
  externalReference!: string;

  @Column({ type: 'enum', enum: ['active', 'rotated', 'revoked'], enumName: 'key_status', default: 'active' })
  status!: 'active' | 'rotated' | 'revoked';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'rotated_at', type: 'timestamptz', nullable: true })
  rotatedAt!: Date | null;
}

