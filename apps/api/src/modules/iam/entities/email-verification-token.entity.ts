import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Extensión (no está en el diagrama): AuthService.verifyEmail(token) necesita dónde guardar el hash del token. */
@Entity({ schema: 'iam', name: 'email_verification_token' })
export class EmailVerificationToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** SHA-256 hex. El token en claro solo viaja por correo. */
  @Column({ name: 'token_hash', type: 'varchar', length: 64, unique: true })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;
}
