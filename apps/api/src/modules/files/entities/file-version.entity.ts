import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { FileRecord } from './file-record.entity';

@Entity('file_versions')
export class FileVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => FileRecord, (f) => f.versions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'file_id' })
  fileRecord: FileRecord;

  @Column({ name: 'file_id' })
  fileId: string;

  @Column({ name: 'version_number' })
  versionNumber: number;

  /** Clave del objeto en MinIO con prefijo de organización */
  @Column({ name: 'object_key' })
  objectKey: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes: string;

  @Column({ name: 'uploaded_by' })
  uploadedBy: string;

  @CreateDateColumn({ name: 'uploaded_at' })
  uploadedAt: Date;
}
