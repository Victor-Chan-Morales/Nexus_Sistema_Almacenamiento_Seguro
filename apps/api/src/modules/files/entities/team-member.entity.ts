import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** SPEC-220: niveles de acceso de un miembro a un equipo. El valor `admin` del tipo de BD no aplica a equipos. */
export const TEAM_LEVELS = ['read', 'write'] as const;
export type TeamLevel = (typeof TEAM_LEVELS)[number];

/** SPEC-220: miembro de un equipo con su nivel. Tabla `files.team_member` (clave compuesta equipo + usuario). */
@Entity({ schema: 'files', name: 'team_member' })
export class TeamMember {
  @PrimaryColumn({ name: 'team_id', type: 'uuid' })
  teamId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({
    name: 'permission_level',
    type: 'enum',
    enum: [...TEAM_LEVELS],
    enumName: 'permission_level',
  })
  level!: TeamLevel;

  @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
  joinedAt!: Date;
}
