import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { Roles } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { RolesGuard } from '../iam/guards/roles.guard';
import {
  AddTeamMemberDto,
  ChangeTeamMemberLevelDto,
  CreatedTeamDto,
  CreateTeamDto,
  TeamMembersResponseDto,
  TeamsResponseDto,
} from './dto/team.dto';
import { TeamActor, TeamsService } from './teams.service';

/**
 * SPEC-220: equipos y sus miembros. Solo traduce HTTP ↔ caso de uso. La organización y el rol salen de la
 * sesión (req.user), nunca del cuerpo. Las rutas de administración exigen `tenant_admin` (RolesGuard);
 * `GET /teams` lo puede usar cualquier miembro.
 */
@Controller('teams')
@UseGuards(AuthGuard('jwt'), RolesGuard) // el guard JWT va primero: RolesGuard lee req.user
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  /** Crea el equipo con su Drive y su carpeta raíz. Responde 201. */
  @Post()
  @Roles(Role.TENANT_ADMIN)
  createTeam(@CurrentUser() user: AuthUser, @Body() dto: CreateTeamDto): Promise<CreatedTeamDto> {
    return this.teams.createTeam(dto, this.actorOf(user));
  }

  /** Equipos visibles para quien pide la lista, con su `memberCount` y su `myLevel`. */
  @Get()
  listTeams(@CurrentUser() user: AuthUser): Promise<TeamsResponseDto> {
    return this.teams.listTeams(this.actorOf(user));
  }

  /** Miembros activos del equipo con su nivel. */
  @Get(':id/members')
  @Roles(Role.TENANT_ADMIN)
  listMembers(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) teamId: string,
  ): Promise<TeamMembersResponseDto> {
    return this.teams.listMembers(teamId, this.actorOf(user));
  }

  /** Agrega un miembro con nivel. Responde 201 sin cuerpo. */
  @Post(':id/members')
  @Roles(Role.TENANT_ADMIN)
  async addMember(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) teamId: string,
    @Body() dto: AddTeamMemberDto,
  ): Promise<void> {
    await this.teams.addMember(teamId, dto, this.actorOf(user));
  }

  /** Cambia el nivel de un miembro. Responde 200 sin cuerpo. */
  @Patch(':id/members/:userId')
  @Roles(Role.TENANT_ADMIN)
  async changeMemberLevel(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) teamId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: ChangeTeamMemberLevelDto,
  ): Promise<void> {
    await this.teams.changeMemberLevel(teamId, userId, dto, this.actorOf(user));
  }

  /** Quita a un miembro del equipo. Responde 204. */
  @Delete(':id/members/:userId')
  @Roles(Role.TENANT_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) teamId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.teams.removeMember(teamId, userId, this.actorOf(user));
  }

  private actorOf(user: AuthUser): TeamActor {
    return { organizationId: user.organizationId, userId: user.userId, role: user.role };
  }
}
