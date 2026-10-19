import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'files', name: 'destination' })
export class Destination {
  @PrimaryGeneratedColumn('uuid', { name: 'destination_id' })
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'provider_type', type: 'enum', enum: ['s3', 'minio'], enumName: 'destination_provider' })
  providerType!: 's3' | 'minio';

  @Column({ name: 'connection_status', type: 'enum', enum: ['Sin comprobar', 'Comprobando', 'Conectado', 'Sin conexión'], enumName: 'connection_status', default: 'Sin comprobar' })
  connectionStatus!: 'Sin comprobar' | 'Comprobando' | 'Conectado' | 'Sin conexión';

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled!: boolean;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ name: 'bucket_or_prefix', type: 'varchar', length: 255 })
  bucketOrPrefix!: string;

  @Column({ name: 'connection_details_encrypted', type: 'text' })
  connectionDetailsEncrypted!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt!: Date | null;
}

