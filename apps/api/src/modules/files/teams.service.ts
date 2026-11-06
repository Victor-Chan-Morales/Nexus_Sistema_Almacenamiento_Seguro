import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { Role } from '../iam/domain/enums';
import { ActiveMember, MemberAdmission } from '../iam/member-admission';
import { CreateTeamDto, AddTeamMemberDto, ChangeTeamMemberLevelDto, CreatedTeamDto, TeamItemDto, TeamMemberItemDto, TeamsResponseDto, TeamMembersResponseDto } from './dto/team.dto';
import { Drive } from './entities/drive.entity';
import { Folder } from './entities/folder.entity';
import { Team } from './entities/team.entity';
import { TeamLevel, TeamMember } from './entities/team-member.entity';
import { FilesService } from './files.service';

/** SPEC-220: quién pide la operación. Siempre sale de la sesión autenticada, nunca del cuerpo. */
export interface TeamActor {
  organizationId: string;
  userId: string;
  role: Role;
}

/** Solo la parte de Files que Equipos necesita: crear la raíz del Drive con el destino del tenant (ISP). */
export type TenantResources = Pick<FilesService, 'ensureTenantResources'>;

/** Solo la parte de IAM que Equipos necesita: validar y listar miembros activos (ISP / DIP). */
export interface ActiveMemberDirectory {
  isActiveMember(organizationId: string, userId: string): Promise<boolean>;
  activeMembers(organizationId: string): Promise<ActiveMember[]>;
}

/** SPEC-220: errores de equipos con el mismo formato que los demás módulos: { code, message }. */
export const TeamErrors = {
  nameConflict: () =>
    new ConflictException({ code: 'TEAM_NAME_CONFLICT', message: 'Ya existe un equipo con ese nombre' }),
  memberExists: () =>
    new ConflictException({ code: 'TEAM_MEMBER_EXISTS', message: 'Esa persona ya pertenece al equipo' }),
  userNotInOrganization: () =>
    new UnprocessableEntityException({
      code: 'USER_NOT_IN_ORGANIZATION',
      message: 'La persona no es miembro activo de esta organización',
    }),
  teamNotFound: (teamId: string) => new NotFoundException('Equipo ' + teamId + ' no encontrado'),
  memberNotFound: (teamId: string) =>
    new NotFoundException('Miembro no encontrado en el equipo ' + teamId),
};

/**
 * SPEC-220: nivel de un equipo para quien pide la lista. El tenant_admin siempre tiene `write`, sea o no
 * miembro; cualquier otro miembro tiene el nivel de su fila. Función pura: SPEC-222 la reutiliza.
 */
export function teamLevelOf(role: Role, memberLevel: TeamLevel | undefined): TeamLevel | null {
  if (role === Role.TENANT_ADMIN) return 'write';
  return memberLevel ?? null;
}

/** Violación de restricción única de PostgreSQL (23505) con el nombre de la restricción, o null si es otro error. */
function uniqueViolation(error: unknown): { constraint?: string } | null {
  const e = error as { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } };
  const code = e?.driverError?.code ?? e?.code;
  if (code !== '23505') return null;
  return { constraint: e.driverError?.constraint ?? e.constraint };
}

/** Orden alfabético sin distinguir mayúsculas ni acentos, independiente del collation de la base. */
const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });

/**
 * SPEC-220: equipos y sus miembros. El tenant_admin crea equipos y decide quién pertenece a cada uno con
 * nivel `read` o `write`. Crear un equipo crea también su Drive de tipo `team` y su carpeta raíz, en una
 * sola transacción. La organización sale siempre de `actor`; un equipo ajeno o inexistente responde 404.
 */
@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team) private readonly teamRepository: Repository<Team>,
    @InjectRepository(TeamMember) private readonly memberRepository: Repository<TeamMember>,
    @InjectRepository(Drive) private readonly driveRepository: Repository<Drive>,
    private readonly dataSource: DataSource,
    @Inject(FilesService) private readonly tenantResources: TenantResources,
    @Inject(MemberAdmission) private readonly directory: ActiveMemberDirectory,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  /**
   * Crea el equipo, su Drive `team` y la carpeta raíz `Archivos`, todo en una transacción. El INSERT del
   * equipo va primero: un nombre repetido falla antes de tocar el resto.
   */
  async createTeam(dto: CreateTeamDto, actor: TeamActor): Promise<CreatedTeamDto> {
    let created: { team: Team; drive: Drive };
    try {
      created = await this.dataSource.transaction(async (manager) => {
        const teamRepo = manager.getRepository(Team);
        const team = await teamRepo.save(
          teamRepo.create({ organizationId: actor.organizationId, name: dto.name, createdBy: actor.userId }),
        );

        const { destination } = await this.tenantResources.ensureTenantResources(manager, actor.organizationId);

        const driveRepo = manager.getRepository(Drive);
        const drive = await driveRepo.save(
          driveRepo.create({
            organizationId: actor.organizationId,
            type: 'team',
            ownerUserId: null,
            teamId: team.id,
            name: team.name,
          }),
        );

        const folderRepo = manager.getRepository(Folder);
        await folderRepo.save(
          folderRepo.create({
            organizationId: actor.organizationId,
            driveId: drive.id,
            parentId: null,
            destinationId: destination.id,
            name: 'Archivos',
            createdBy: actor.userId,
            isDeleted: false,
            deletedAt: null,
          }),
        );

        return { team, drive };
      });
    } catch (error) {
      if (uniqueViolation(error)?.constraint === 'uq_team_name_per_organization') throw TeamErrors.nameConflict();
      throw error;
    }

    this.audit(AuditAction.TEAM_CREATED, actor, created.team.id);
    return {
      id: created.team.id,
      name: created.team.name,
      driveId: created.drive.id,
      createdAt: created.team.createdAt.toISOString(),
    };
  }

  /**
   * Equipos visibles para el actor. El tenant_admin ve todos los de su organización; un colaborador solo
   * aquellos a los que pertenece. `memberCount` cuenta solo miembros con membresía activa.
   */
  async listTeams(actor: TeamActor): Promise<TeamsResponseDto> {
    const teams = await this.visibleTeams(actor);
    if (teams.length === 0) return { items: [] };

    const teamIds = teams.map((team) => team.id);
    const [rows, drives, activeMembers] = await Promise.all([
      this.memberRepository.find({ where: { teamId: In(teamIds) } }),
      this.driveRepository.find({
        where: { organizationId: actor.organizationId, type: 'team', teamId: In(teamIds) },
      }),
      this.directory.activeMembers(actor.organizationId),
    ]);

    const activeUserIds = new Set(activeMembers.map((member) => member.userId));
    const driveByTeam = new Map(drives.map((drive) => [drive.teamId, drive.id]));

    const items: TeamItemDto[] = teams.sort(byName).map((team) => {
      const teamRows = rows.filter((row) => row.teamId === team.id);
      const ownRow = teamRows.find((row) => row.userId === actor.userId);
      return {
        id: team.id,
        name: team.name,
        driveId: driveByTeam.get(team.id) ?? null,
        memberCount: teamRows.filter((row) => activeUserIds.has(row.userId)).length,
        myLevel: teamLevelOf(actor.role, ownRow?.level),
      };
    });
    return { items };
  }

  /** Miembros activos del equipo, del más antiguo al más nuevo. Solo lo usa el tenant_admin (guard del controlador). */
  async listMembers(teamId: string, actor: TeamActor): Promise<TeamMembersResponseDto> {
    await this.requireTeam(teamId, actor.organizationId);

    const [rows, activeMembers] = await Promise.all([
      this.memberRepository.find({ where: { teamId }, order: { joinedAt: 'ASC' } }),
      this.directory.activeMembers(actor.organizationId),
    ]);
    const activeById = new Map(activeMembers.map((member) => [member.userId, member]));

    const items: TeamMemberItemDto[] = [];
    for (const row of rows) {
      const person = activeById.get(row.userId);
      if (!person) continue; // suspendido o eliminado de la organización: no aparece en la lista
      items.push({
        userId: row.userId,
        fullName: person.fullName,
        email: person.email,
        level: row.level,
        joinedAt: row.joinedAt.toISOString(),
      });
    }
    return { items };
  }

  /**
   * Agrega un miembro con nivel. Valida membresía activa en la organización antes de insertar. Usa `insert`
   * y no `save`: un duplicado choca con `pk_team_member` y nunca sobrescribe el nivel existente.
   */
  async addMember(teamId: string, dto: AddTeamMemberDto, actor: TeamActor): Promise<void> {
    await this.requireTeam(teamId, actor.organizationId);

    if (!(await this.directory.isActiveMember(actor.organizationId, dto.userId))) {
      throw TeamErrors.userNotInOrganization();
    }

    try {
      await this.memberRepository.insert({ teamId, userId: dto.userId, level: dto.level });
    } catch (error) {
      if (uniqueViolation(error)?.constraint === 'pk_team_member') throw TeamErrors.memberExists();
      throw error;
    }
    this.audit(AuditAction.TEAM_MEMBER_ADDED, actor, teamId);
  }

  /** Cambia el nivel de un miembro. Mismo nivel: responde sin escribir ni auditar (idempotente). */
  async changeMemberLevel(
    teamId: string,
    userId: string,
    dto: ChangeTeamMemberLevelDto,
    actor: TeamActor,
  ): Promise<void> {
    await this.requireTeam(teamId, actor.organizationId);

    const row = await this.memberRepository.findOne({ where: { teamId, userId } });
    if (!row) throw TeamErrors.memberNotFound(teamId);
    if (row.level === dto.level) return;

    await this.memberRepository.update({ teamId, userId }, { level: dto.level });
    this.audit(AuditAction.TEAM_MEMBER_LEVEL_CHANGED, actor, teamId);
  }

  /** Quita a un miembro del equipo. Sin fila responde 404. */
  async removeMember(teamId: string, userId: string, actor: TeamActor): Promise<void> {
    await this.requireTeam(teamId, actor.organizationId);

    const result = await this.memberRepository.delete({ teamId, userId });
    if (!result.affected) throw TeamErrors.memberNotFound(teamId);
    this.audit(AuditAction.TEAM_MEMBER_REMOVED, actor, teamId);
  }

  /** Equipos que el actor puede ver: todos para el tenant_admin; solo los suyos para el resto. */
  private async visibleTeams(actor: TeamActor): Promise<Team[]> {
    if (actor.role === Role.TENANT_ADMIN) {
      return this.teamRepository.find({ where: { organizationId: actor.organizationId } });
    }
    const own = await this.memberRepository.find({ where: { userId: actor.userId } });
    if (own.length === 0) return [];
    return this.teamRepository.find({
      where: { organizationId: actor.organizationId, id: In(own.map((row) => row.teamId)) },
    });
  }

  /** Equipo de la organización del actor; el de otra organización o inexistente responde 404 igual. */
  private async requireTeam(teamId: string, organizationId: string): Promise<Team> {
    const team = await this.teamRepository.findOne({ where: { id: teamId, organizationId } });
    if (!team) throw TeamErrors.teamNotFound(teamId);
    return team;
  }

  /** Registro de auditoría posterior al commit. El evento no lleva nombre de equipo ni datos personales. */
  private audit(action: AuditAction, actor: TeamActor, teamId: string): void {
    void this.auditService?.logEvent({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action,
      resourceType: AuditResource.TEAM,
      resourceId: teamId,
    }).catch(() => {});
  }
}
