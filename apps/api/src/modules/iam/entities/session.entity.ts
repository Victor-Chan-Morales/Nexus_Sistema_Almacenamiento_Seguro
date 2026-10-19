import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Tabla iam.session. Guarda la organización activa con la que se abrió la sesión: el refresh la conserva
 * y revalida su membresía, sin elegir otra organización en silencio.
 * No se mapean ip_address, user_agent ni created_at (la BD pone el valor por defecto).
 */
@Entity({ schema: 'iam', name: 'session' })
export class Session {
  @PrimaryGeneratedColumn('uuid', { name: 'session_id' })
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** SHA-256 hex del refresh token. El valor en claro solo vive en la cookie HttpOnly. */
  @Column({ name: 'refresh_token_hash', type: 'varchar', length: 255 })
  refreshTokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  isExpired(now: Date = new Date()): boolean {
    return this.expiresAt.getTime() <= now.getTime();
  }

  isRevoked(): boolean {
    return this.revokedAt !== null;
  }
}
