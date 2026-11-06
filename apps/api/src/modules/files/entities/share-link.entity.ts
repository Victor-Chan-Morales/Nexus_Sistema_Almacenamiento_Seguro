import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** SPEC-209: enlace temporal a una versión fija de un archivo. Solo se guarda el hash del token. */
@Entity({ schema: 'files', name: 'share_link' })
export class ShareLink {
  @PrimaryGeneratedColumn('uuid', { name: 'link_id' })
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'version_id', type: 'uuid' })
  versionId!: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 255 })
  tokenHash!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true })
  passwordHash!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
