import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'files', name: 'upload' })
export class Upload {
  @PrimaryGeneratedColumn('uuid', { name: 'upload_id' })
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'folder_id', type: 'uuid' })
  folderId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ name: 'declared_name', type: 'varchar', length: 255 })
  declaredName!: string;

  @Column({ name: 'declared_size_bytes', type: 'bigint' })
  declaredSizeBytes!: string;

  @Column({ name: 'received_size_bytes', type: 'bigint', nullable: true })
  receivedSizeBytes!: string | null;

  @Column({ type: 'enum', enum: ['Pendiente', 'Cargando', 'Confirmando', 'Disponible', 'Fallida', 'Limpieza pendiente'], enumName: 'upload_status', default: 'Pendiente' })
  status!: 'Pendiente' | 'Cargando' | 'Confirmando' | 'Disponible' | 'Fallida' | 'Limpieza pendiente';

  @Column({ name: 'reservation_id', type: 'uuid', unique: true })
  reservationId!: string;

  @Column({ name: 'destination_id', type: 'uuid' })
  destinationId!: string;

  @Column({ name: 'object_key', type: 'varchar', length: 500, nullable: true })
  objectKey!: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt!: Date | null;
}

