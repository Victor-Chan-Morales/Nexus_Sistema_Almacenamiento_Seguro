import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { FileVersion } from "./file-version.entity";
import { Folder } from "./folder.entity";

@Entity({ schema: "files", name: "file" })
export class FileRecord {
  @PrimaryGeneratedColumn("uuid", { name: "file_id" })
  id!: string;

  @Column({ name: "organization_id", type: "uuid" })
  organizationId!: string;

  @Column({ name: "folder_id", type: "uuid" })
  folderId!: string;

  @ManyToOne(() => Folder, { nullable: false })
  @JoinColumn({ name: "folder_id", referencedColumnName: "id" })
  folder?: Folder;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ name: "mime_type", type: "varchar", length: 100, nullable: true })
  mimeType!: string | null;

  @Column({ name: "current_version_id", type: "uuid", nullable: true })
  currentVersionId!: string | null;

  @Column({ name: "is_deleted", type: "boolean", default: false })
  isDeleted!: boolean;

  @Column({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  @Column({ name: "created_by", type: "uuid" })
  createdBy!: string;

  @OneToMany(() => FileVersion, (version) => version.fileRecord)
  versions!: FileVersion[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz", nullable: true })
  updatedAt!: Date | null;
}
