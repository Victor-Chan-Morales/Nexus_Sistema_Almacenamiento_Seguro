import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { FileRecord } from './file-record.entity';

@Entity({ schema: 'files', name: 'file_version' })
export class FileVersion {
  @PrimaryGeneratedColumn('uuid', { name: 'version_id' })
  id!: string;

  @Column({ name: 'file_id', type: 'uuid' })
  fileId!: string;

  @ManyToOne(() => FileRecord, (file) => file.versions, { nullable: false })
  @JoinColumn({ name: 'file_id', referencedColumnName: 'id' })
  fileRecord!: FileRecord;

  @Column({ name: 'version_number', type: 'integer' })
  versionNumber!: number;

  @Column({ name: 'destination_id', type: 'uuid' })
  destinationId!: string;

  @Column({ name: 'object_key', type: 'varchar', length: 500 })
  objectKey!: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: string;

  @Column({ type: 'varchar', length: 128 })
  checksum!: string;

  @Column({ name: 'encrypted_dek', type: 'varchar', length: 500 })
  encryptedDek!: string;

  @Column({ name: 'kek_id', type: 'uuid' })
  kekId!: string;

  @Column({ name: 'format_version', type: 'smallint' })
  formatVersion!: number;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedBy!: string;

  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt!: Date;
}
