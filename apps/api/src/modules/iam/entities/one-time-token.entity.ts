import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Tabla iam.one_time_token: tokens de un solo uso para verificación de correo y restablecimiento de contraseña
 * (ENUM iam.token_purpose). Un token de un propósito nunca sirve para el otro: siempre se filtra por `purpose`.
 */
@Entity({ schema: 'iam', name: 'one_time_token' })
export class OneTimeToken {
  @PrimaryGeneratedColumn('uuid', { name: 'token_id' })
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** SHA-256 hex. El token en claro solo viaja por correo. */
  @Column({ name: 'token_hash', type: 'varchar', length: 255 })
  tokenHash!: string;

  @Column({ type: 'varchar' })
  purpose!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;
}
