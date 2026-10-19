import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Drive } from './drive.entity';

@Entity({ schema: 'files', name: 'folder' })
export class Folder {
  @PrimaryGeneratedColumn('uuid', { name: 'folder_id' })
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'drive_id', type: 'uuid' })
  driveId!: string;

  @ManyToOne(() => Drive, { nullable: false })
  @JoinColumn({ name: 'drive_id', referencedColumnName: 'id' })
  drive?: Drive;

  @Column({ name: 'parent_folder_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @Column({ name: 'destination_id', type: 'uuid', nullable: true })
  destinationId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted!: boolean;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt!: Date | null;
}
