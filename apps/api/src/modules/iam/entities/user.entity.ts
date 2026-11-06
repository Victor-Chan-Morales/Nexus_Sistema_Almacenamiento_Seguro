import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Tabla iam.user. No se mapean (tienen valor por defecto en la BD o no se usan aún):
 * mfa_secret_encrypted, last_login_at, created_at, updated_at.
 */
@Entity({ schema: 'iam', name: 'user' })
export class User {
  @PrimaryGeneratedColumn('uuid', { name: 'user_id' })
  id!: string;

  /** La BD exige minúsculas (CHECK ck_user_email_lowercase) y es único. */
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  /** Hash Argon2id. Nunca se devuelve ni se registra. */
  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 150 })
  fullName!: string;

  @Column({ name: 'email_verified', type: 'boolean', default: false })
  emailVerified!: boolean;

  /** MFA/TOTP está fuera del alcance actual: IAM falla cerrado si llega en true. */
  @Column({ name: 'mfa_enabled', type: 'boolean', default: false })
  mfaEnabled!: boolean;

  @Column({ name: 'is_super_admin', type: 'boolean', default: false })
  isSuperAdmin!: boolean;

  /** Fallos de contraseña seguidos (smallint). Solo se modifica con UPDATE atómico en SQL (SPEC-112). */
  @Column({ name: 'failed_login_attempts', type: 'smallint', default: 0 })
  failedLoginAttempts!: number;

  /** Mientras sea futuro no se aceptan intentos de login (SPEC-112). NULL = sin bloqueo temporal. */
  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  /** ENUM iam.user_status (active | inactive | locked). */
  @Column({ type: 'varchar' })
  status!: string;
}
