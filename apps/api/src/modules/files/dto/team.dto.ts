import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { trim } from '../../iam/dto/register.dto';
import { TEAM_LEVELS, TeamLevel } from '../entities/team-member.entity';

/** SPEC-220: cuerpo de `POST /teams`. El nombre se recorta; la unicidad sin distinguir mayúsculas la decide la BD. */
export class CreateTeamDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;
}

/** SPEC-220: cuerpo de `POST /teams/:id/members`. La membresía activa se valida en el servicio, no aquí. */
export class AddTeamMemberDto {
  @IsUUID()
  userId!: string;

  @IsIn(TEAM_LEVELS)
  level!: TeamLevel;
}

/** SPEC-220: cuerpo de `PATCH /teams/:id/members/:userId`. */
export class ChangeTeamMemberLevelDto {
  @IsIn(TEAM_LEVELS)
  level!: TeamLevel;
}

/** SPEC-220: respuesta de la creación. `driveId` es el Drive de tipo `team` que se creó junto al equipo. */
export class CreatedTeamDto {
  id: string;
  name: string;
  driveId: string;
  createdAt: string;
}

/**
 * SPEC-220: un equipo en el listado. `myLevel` es `write` para todo tenant_admin, sea o no miembro;
 * para un colaborador es el nivel de su fila, y `null` si no pertenece (no aparece en el listado).
 */
export class TeamItemDto {
  id: string;
  name: string;
  driveId: string;
  memberCount: number;
  myLevel: TeamLevel | null;
}

/** SPEC-220: respuesta de `GET /teams`, ordenada por nombre. */
export class TeamsResponseDto {
  items: TeamItemDto[];
}

/** SPEC-220: un miembro activo del equipo. Nunca incluye el hash de contraseña. */
export class TeamMemberItemDto {
  userId: string;
  fullName: string;
  email: string;
  level: TeamLevel;
  joinedAt: string;
}

/** SPEC-220: respuesta de `GET /teams/:id/members`. Solo miembros con membresía activa en la organización. */
export class TeamMembersResponseDto {
  items: TeamMemberItemDto[];
}
