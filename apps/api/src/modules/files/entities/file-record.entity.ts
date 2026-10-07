import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany,
} from 'typeorm';
import { FileVersion } from './file-version.entity';

@Entity('file_records')
export class FileRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'owner_id' })
  ownerId: string;

  /** Carpeta padre (null = raíz) */
  @Column({ name: 'folder_id', nullable: true })
  folderId: string;

  @Column({ name: 'mime_type', nullable: true })
  mimeType: string;

  /** Tamaño total en bytes de la versión más reciente */
  @Column({ name: 'size_bytes', type: 'bigint', default: 0 })
  sizeBytes: string;

  @Column({ name: 'is_deleted', default: false })
  isDeleted: boolean;

  @OneToMany(() => FileVersion, (v) => v.fileRecord)
  versions: FileVersion[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
