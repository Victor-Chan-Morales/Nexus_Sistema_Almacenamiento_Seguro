import { ConflictException, HttpException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, FindOperator, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditEventInput, AuditResource } from '../audit/audit.types';
import { Role } from '../iam/domain/enums';
import { ActiveMember, MemberAdmission } from '../iam/member-admission';
import { Drive } from './entities/drive.entity';
import { Folder } from './entities/folder.entity';
import { Team } from './entities/team.entity';
import { TeamMember, TeamLevel } from './entities/team-member.entity';
import { FilesService } from './files.service';
import { TeamErrors, TeamsService, teamLevelOf } from './teams.service';

/** SPEC-220: pruebas unitarias de equipos y miembros. Escenarios 1 a 9 de la spec. */

const ORG = 'org-1';
const ORG_2 = 'org-2';
const ADMIN = { organizationId: ORG, userId: 'admin-1', role: Role.TENANT_ADMIN };
const COLAB = { organizationId: ORG, userId: 'user-1', role: Role.COLABORADOR };
const DEST = 'dest-1';

type Row = Record<string, unknown>;

/** Error con la forma que entrega TypeORM ante una violación de restricción de PostgreSQL. */
const dbError = (constraint: string) =>
  Object.assign(new Error('duplicate key value violates unique constraint'), {
    driverError: { code: '23505', constraint },
  });

/** Ejecuta la promesa y devuelve el error de Nest, o falla si no lanzó. */
const errorOf = async (work: Promise<unknown>): Promise<HttpException> => {
  try {
    await work;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('se esperaba un error y no lo hubo');
};

const buildFixture = () => {
  const teams: Team[] = [];
  const members: TeamMember[] = [];
  const drives: Drive[] = [];
  const folders: Folder[] = [];

  /** Fallos inyectables para simular restricciones y errores de la base. */
  const faults: { teamConstraint?: string; folderError?: boolean } = {};

  /** Repositorio en memoria con la forma que usa el servicio. Los filtros replican los `where` reales. */
  const makeRepo = (
    rows: Row[],
    options: { withId?: boolean; beforeWrite?: (data: Row) => void } = {},
  ) => {
    const matches = (row: Row, where: Row) =>
      Object.entries(where).every(([key, expected]) => {
        const actual = row[key];
        if (expected instanceof FindOperator) {
          return expected.type === 'in' && (expected.value as unknown[]).includes(actual);
        }
        return actual === expected;
      });
    const select = (opts: { where?: Row; order?: Row } = {}) => {
      const found = rows.filter((row) => matches(row, opts.where ?? {}));
      const [orderKey] = Object.keys(opts.order ?? {});
      if (orderKey) {
        found.sort((a, b) => ((a[orderKey] as Date) > (b[orderKey] as Date) ? 1 : -1));
      }
      return found;
    };
    const repo = {
      create: (data: Row) => ({ ...data }),
      save: jest.fn(async (data: Row) => {
        options.beforeWrite?.(data);
        const row: Row = options.withId
          ? { ...data, id: randomUUID(), createdAt: new Date() }
          : { ...data };
        rows.push(row);
        return row;
      }),
      insert: jest.fn(async (data: Row) => {
        options.beforeWrite?.(data);
        rows.push({ ...data, joinedAt: new Date() });
        return { identifiers: [], generatedMaps: [], raw: [] };
      }),
      find: jest.fn(async (opts?: { where?: Row; order?: Row }) => select(opts)),
      findOne: jest.fn(async (opts: { where?: Row }) => select(opts)[0] ?? null),
      update: jest.fn(async (criteria: Row, patch: Row) => {
        const hit = rows.filter((row) => matches(row, criteria));
        hit.forEach((row) => Object.assign(row, patch));
        return { affected: hit.length };
      }),
      delete: jest.fn(async (criteria: Row) => {
        const kept = rows.filter((row) => !matches(row, criteria));
        const affected = rows.length - kept.length;
        rows.splice(0, rows.length, ...kept);
        return { affected };
      }),
    };
    return repo;
  };

  const teamRepo = makeRepo(teams as unknown as Row[], {
    withId: true,
    beforeWrite: (data) => {
      if (faults.teamConstraint) throw dbError(faults.teamConstraint);
      const name = String(data.name).toLowerCase();
      if (teams.some((t) => t.organizationId === data.organizationId && t.name.toLowerCase() === name)) {
        throw dbError('uq_team_name_per_organization');
      }
    },
  });
  const memberRepo = makeRepo(members as unknown as Row[], {
    beforeWrite: (data) => {
      if (members.some((m) => m.teamId === data.teamId && m.userId === data.userId)) {
        throw dbError('pk_team_member');
      }
    },
  });
  const driveRepo = makeRepo(drives as unknown as Row[], { withId: true });
  const folderRepo = makeRepo(folders as unknown as Row[], {
    withId: true,
    beforeWrite: () => {
      if (faults.folderError) throw new Error('fallo simulado al guardar la carpeta');
    },
  });

  const repoFor = (entity: unknown) => {
    if (entity === Team) return teamRepo;
    if (entity === TeamMember) return memberRepo;
    if (entity === Drive) return driveRepo;
    if (entity === Folder) return folderRepo;
    throw new Error('entidad no esperada');
  };

  /** Transacción con rollback real: si el trabajo falla, las filas vuelven a su estado anterior. */
  let lastManager: EntityManager | undefined;
  const tables = [teams, members, drives, folders] as unknown as Row[][];
  const dataSource = {
    transaction: jest.fn(async (work: (manager: EntityManager) => Promise<unknown>) => {
      const snapshot = tables.map((rows) => [...rows]);
      const manager = { getRepository: repoFor } as unknown as EntityManager;
      lastManager = manager;
      try {
        return await work(manager);
      } catch (error) {
        tables.forEach((rows, i) => rows.splice(0, rows.length, ...snapshot[i]));
        throw error;
      }
    }),
  } as unknown as DataSource;

  const active = new Map<string, ActiveMember[]>();
  const directory = {
    setActive: (organizationId: string, userIds: string[]) =>
      active.set(
        organizationId,
        userIds.map((userId) => ({ userId, fullName: 'Nombre ' + userId, email: userId + '@example.com' })),
      ),
    /** Se ejecuta al validar un miembro: permite simular que otra petición lo agrega antes del INSERT. */
    onCheck: undefined as (() => void) | undefined,
  };
  const admission = {
    isActiveMember: jest.fn(async (organizationId: string, userId: string) => {
      directory.onCheck?.();
      return (active.get(organizationId) ?? []).some((m) => m.userId === userId);
    }),
    activeMembers: jest.fn(async (organizationId: string) => active.get(organizationId) ?? []),
  };

  const tenantResources = {
    ensureTenantResources: jest.fn(async () => ({ destination: { id: DEST }, key: {} })),
  };
  const logEvent = jest.fn<Promise<void>, [AuditEventInput]>().mockResolvedValue(undefined);

  const service = new TeamsService(
    teamRepo as unknown as Repository<Team>,
    memberRepo as unknown as Repository<TeamMember>,
    driveRepo as unknown as Repository<Drive>,
    dataSource,
    tenantResources as unknown as Pick<FilesService, 'ensureTenantResources'>,
    admission as unknown as MemberAdmission,
    { logEvent } as unknown as AuditService,
  );

  /** Equipo sembrado con su Drive `team`, como lo deja createTeam. */
  let clock = 0;
  const seedTeam = (id: string, name: string, organizationId = ORG) => {
    teams.push({ id, organizationId, name, createdBy: ADMIN.userId, createdAt: new Date(2026, 0, 1 + clock++) } as Team);
    drives.push({
      id: 'drive-' + id,
      organizationId,
      type: 'team',
      ownerUserId: null,
      teamId: id,
      name,
      createdAt: new Date(),
    } as Drive);
  };
  const seedMember = (teamId: string, userId: string, level: TeamLevel, joinedAt = new Date(2026, 0, 1 + clock++)) => {
    members.push({ teamId, userId, level, joinedAt } as TeamMember);
  };

  return {
    service,
    teams,
    members,
    drives,
    folders,
    faults,
    directory,
    dataSource,
    tenantResources,
    logEvent,
    memberRepo,
    teamRepo,
    seedTeam,
    seedMember,
    getLastManager: () => lastManager,
  };
};

describe('TeamsService (SPEC-220)', () => {
  describe('Escenario 1: Crear', () => {
    it('crea el equipo, su Drive team y la carpeta raíz Archivos en una sola transacción', async () => {
      const fx = buildFixture();

      const result = await fx.service.createTeam({ name: 'Ventas' }, ADMIN);

      expect(fx.dataSource.transaction).toHaveBeenCalledTimes(1);
      const team = fx.teams[0];
      expect(team).toMatchObject({ name: 'Ventas', organizationId: ORG, createdBy: ADMIN.userId });
      expect(fx.drives).toEqual([
        expect.objectContaining({ type: 'team', ownerUserId: null, teamId: team.id, name: 'Ventas', organizationId: ORG }),
      ]);
      const drive = fx.drives[0];
      expect(fx.folders).toEqual([
        expect.objectContaining({
          driveId: drive.id,
          parentId: null,
          destinationId: DEST,
          name: 'Archivos',
          createdBy: ADMIN.userId,
          isDeleted: false,
          organizationId: ORG,
        }),
      ]);
      expect(result).toEqual({
        id: team.id,
        name: 'Ventas',
        driveId: drive.id,
        createdAt: team.createdAt.toISOString(),
      });
    });

    it('resuelve el destino con el mismo EntityManager de la transacción', async () => {
      const fx = buildFixture();

      await fx.service.createTeam({ name: 'Ventas' }, ADMIN);

      expect(fx.tenantResources.ensureTenantResources).toHaveBeenCalledWith(fx.getLastManager(), ORG);
    });

    it('si falla la carpeta raíz no queda ni equipo ni Drive (atomicidad)', async () => {
      const fx = buildFixture();
      fx.faults.folderError = true;

      await expect(fx.service.createTeam({ name: 'Ventas' }, ADMIN)).rejects.toThrow('fallo simulado');

      expect(fx.teams).toHaveLength(0);
      expect(fx.drives).toHaveLength(0);
      expect(fx.folders).toHaveLength(0);
      expect(fx.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('Escenario 2: Nombre repetido', () => {
    it('mismo nombre sin distinguir mayúsculas → 409 TEAM_NAME_CONFLICT, sin Drive ni auditoría nueva', async () => {
      const fx = buildFixture();
      fx.seedTeam('team-1', 'Ventas');
      const drivesBefore = fx.drives.length;

      const error = await errorOf(fx.service.createTeam({ name: 'VENTAS' }, ADMIN));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual(expect.objectContaining({ code: 'TEAM_NAME_CONFLICT' }));
      expect(fx.teams).toHaveLength(1);
      expect(fx.drives).toHaveLength(drivesBefore);
      expect(fx.logEvent).not.toHaveBeenCalled();
    });

    it('el mismo nombre en otra organización sí se permite', async () => {
      const fx = buildFixture();
      fx.seedTeam('team-otra', 'Ventas', ORG_2);

      await expect(fx.service.createTeam({ name: 'Ventas' }, ADMIN)).resolves.toEqual(
        expect.objectContaining({ name: 'Ventas' }),
      );
    });

    it('otra violación de restricción única se relanza sin convertirse en 409', async () => {
      const fx = buildFixture();
      fx.faults.teamConstraint = 'otra_restriccion';

      const failure = await fx.service.createTeam({ name: 'Ventas' }, ADMIN).catch((e: unknown) => e);

      expect(failure).not.toBeInstanceOf(ConflictException);
      expect((failure as { driverError: { constraint: string } }).driverError.constraint).toBe('otra_restriccion');
    });
  });

  describe('Escenario 3: Agregar miembro', () => {
    it('agrega con nivel read y con nivel write, sin cuerpo de respuesta', async () => {
      const fx = buildFixture();
      fx.seedTeam('team-1', 'Ventas');
      fx.directory.setActive(ORG, ['user-1', 'user-2']);

      await expect(fx.service.addMember('team-1', { userId: 'user-1', level: 'read' }, ADMIN)).resolves.toBeUndefined();
      await expect(fx.service.addMember('team-1', { userId: 'user-2', level: 'write' }, ADMIN)).resolves.toBeUndefined();

      expect(fx.members).toEqual([
        expect.objectContaining({ teamId: 'team-1', userId: 'user-1', level: 'read' }),
        expect.objectContaining({ teamId: 'team-1', userId: 'user-2', level: 'write' }),
      ]);
      expect(fx.logEvent).toHaveBeenCalledWith({
        organizationId: ORG,
        actorId: ADMIN.userId,
        action: AuditAction.TEAM_MEMBER_ADDED,
        resourceType: AuditResource.TEAM,
        resourceId: 'team-1',
      });
    });
  });

  describe('Escenario 4: Miembro inválido', () => {
    it('usuario sin membresía activa → 422 USER_NOT_IN_ORGANIZATION, sin insertar ni auditar', async () => {
      const fx = buildFixture();
      fx.seedTeam('team-1', 'Ventas');
      fx.directory.setActive(ORG, ['user-1']);

      const error = await errorOf(fx.service.addMember('team-1', { userId: 'user-9', level: 'read' }, ADMIN));

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.getResponse()).toEqual(expect.objectContaining({ code: 'USER_NOT_IN_ORGANIZATION' }));
      expect(fx.members).toHaveLength(0);
      expect(fx.logEvent).not.toHaveBeenCalled();
    });

    it('persona ya presente → 409 TEAM_MEMBER_EXISTS y el nivel original no cambia', async () => {
      const fx = buildFixture();
      fx.seedTeam('team-1', 'Ventas');
      fx.seedMember('team-1', 'user-1', 'read');
      fx.directory.setActive(ORG, ['user-1']);

      const error = await errorOf(fx.service.addMember('team-1', { userId: 'user-1', level: 'write' }, ADMIN));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual(expect.objectContaining({ code: 'TEAM_MEMBER_EXISTS' }));
      expect(fx.members).toHaveLength(1);
      expect(fx.members[0].level).toBe('read');
      expect(fx.logEvent).not.toHaveBeenCalled();
    });

    it('si otra petición agrega a la persona entre la validación y el INSERT → mismo 409', async () => {
      const fx = buildFixture();
      fx.seedTeam('team-1', 'Ventas');
      fx.directory.setActive(ORG, ['user-1']);
      fx.directory.onCheck = () => {
        fx.directory.onCheck = undefined;
        fx.seedMember('team-1', 'user-1', 'read');
      };

      const error = await errorOf(fx.service.addMember('team-1', { userId: 'user-1', level: 'write' }, ADMIN));

      expect(error.getResponse()).toEqual(expect.objectContaining({ code: 'TEAM_MEMBER_EXISTS' }));
      expect(fx.members[0].level).toBe('read');
    });
  });

  describe('Escenario 5: Cambiar nivel y quitar', () => {
    it('el cambio de nivel aplica en la siguiente lectura y se audita', async () => {
      const fx = buildFixture();
      fx.seedTeam('team-1', 'Ventas');
      fx.seedMember('team-1', 'user-1', 'read');
      fx.directory.setActive(ORG, ['user-1']);

      await expect(
        fx.service.changeMemberLevel('team-1', 'user-1', { level: 'write' }, ADMIN),
      ).resolves.toBeUndefined();
      const { items } = await fx.service.listMembers('team-1', ADMIN);

      expect(items).toEqual([expect.objectContaining({ userId: 'user-1', level: 'write' })]);
      expect(fx.logEvent).toHaveBeenCalledWith({
        organizationId: ORG,
        actorId: ADMIN.userId,
        action: AuditAction.TEAM_MEMBER_LEVEL_CHANGED,
        resourceType: AuditResource.TEAM,
        resourceId: 'team-1',
      });
    });

    it('mismo nivel: responde sin escribir ni auditar (idempotente)', async () => {
      const fx = buildFixture();
      fx.seedTeam('team-1', 'Ventas');
      fx.seedMember('team-1', 'user-1', 'read');

      await fx.service.changeMemberLevel('team-1', 'user-1', { level: 'read' }, ADMIN);

      expect(fx.memberRepo.update).not.toHaveBeenCalled();
      expect(fx.logEvent).not.toHaveBeenCalled();
    });

    it('cambiar el nivel de quien no es miembro → 404 MEMBER no encontrado', async () => {
      const fx = buildFixture();
      fx.seedTeam('team-1', 'Ventas');

      const error = await errorOf(fx.service.changeMemberLevel('team-1', 'user-9', { level: 'write' }, ADMIN));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(fx.logEvent).not.toHaveBeenCalled();
    });

    it('quitar borra la fila y audita; un segundo borrado responde 404', async () => {
      const fx = buildFixture();
      fx.seedTeam('team-1', 'Ventas');
      fx.seedMember('team-1', 'user-1', 'read');

      await expect(fx.service.removeMember('team-1', 'user-1', ADMIN)).resolves.toBeUndefined();
      expect(fx.members).toHaveLength(0);
      expect(fx.logEvent).toHaveBeenCalledTimes(1);
      expect(fx.logEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: AuditAction.TEAM_MEMBER_REMOVED, resourceId: 'team-1' }),
      );

      const error = await errorOf(fx.service.removeMember('team-1', 'user-1', ADMIN));
      expect(error).toBeInstanceOf(NotFoundException);
      expect(fx.logEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('Escenario 6: Listar', () => {
    /** Equipos Zeta, árbol y Beta; el orden esperado es árbol, Beta, Zeta (sin distinguir mayúsculas ni acentos). */
    const seedListing = () => {
      const fx = buildFixture();
      fx.seedTeam('t-z', 'Zeta');
      fx.seedTeam('t-a', 'árbol');
      fx.seedTeam('t-b', 'Beta');
      fx.seedMember('t-z', 'user-1', 'read');
      fx.seedMember('t-z', 'user-2', 'write');
      fx.seedMember('t-b', 'user-1', 'write');
      fx.directory.setActive(ORG, ['user-1', 'user-2']);
      return fx;
    };

    it('tenant_admin ve todos los equipos, con memberCount, driveId y myLevel write aunque no sea miembro', async () => {
      const fx = seedListing();

      const { items } = await fx.service.listTeams(ADMIN);

      expect(items.map((item) => item.name)).toEqual(['árbol', 'Beta', 'Zeta']);
      expect(items.map((item) => item.myLevel)).toEqual(['write', 'write', 'write']);
      expect(items.map((item) => item.memberCount)).toEqual([0, 1, 2]);
      expect(items.map((item) => item.driveId)).toEqual(['drive-t-a', 'drive-t-b', 'drive-t-z']);
    });

    it('colaborador ve solo sus equipos, con el nivel de su fila', async () => {
      const fx = seedListing();

      const { items } = await fx.service.listTeams(COLAB);

      expect(items).toEqual([
        expect.objectContaining({ name: 'Beta', myLevel: 'write' }),
        expect.objectContaining({ name: 'Zeta', myLevel: 'read' }),
      ]);
    });

    it('colaborador sin equipos recibe una lista vacía', async () => {
      const fx = seedListing();

      await expect(
        fx.service.listTeams({ organizationId: ORG, userId: 'user-9', role: Role.COLABORADOR }),
      ).resolves.toEqual({ items: [] });
    });
  });

  describe('Escenario 7: Permisos y aislamiento', () => {
    it('equipo de otra organización o inexistente → 404 en las cuatro operaciones, sin escribir', async () => {
      const fx = buildFixture();
      fx.seedTeam('team-ajeno', 'Ajeno', ORG_2);
      fx.seedMember('team-ajeno', 'user-2', 'read');
      fx.directory.setActive(ORG, ['user-1']);
      const membersBefore = fx.members.length;

      for (const teamId of ['team-ajeno', randomUUID()]) {
        expect((await errorOf(fx.service.listMembers(teamId, ADMIN))).getStatus()).toBe(404);
        expect((await errorOf(fx.service.addMember(teamId, { userId: 'user-1', level: 'read' }, ADMIN))).getStatus()).toBe(404);
        expect(
          (await errorOf(fx.service.changeMemberLevel(teamId, 'user-2', { level: 'write' }, ADMIN))).getStatus(),
        ).toBe(404);
        expect((await errorOf(fx.service.removeMember(teamId, 'user-2', ADMIN))).getStatus()).toBe(404);
      }

      expect(fx.members).toHaveLength(membersBefore);
      expect(fx.members[0].level).toBe('read');
      expect(fx.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('Escenario 8: Miembro eliminado o suspendido', () => {
    it('no aparece en la lista del equipo ni cuenta en memberCount; al reactivarse vuelve con su nivel', async () => {
      const fx = buildFixture();
      fx.seedTeam('team-1', 'Ventas');
      fx.seedMember('team-1', 'user-1', 'read');
      fx.seedMember('team-1', 'user-2', 'write');
      fx.directory.setActive(ORG, ['user-1']);

      const list = await fx.service.listMembers('team-1', ADMIN);
      const summary = await fx.service.listTeams(ADMIN);

      expect(list.items.map((item) => item.userId)).toEqual(['user-1']);
      expect(summary.items[0].memberCount).toBe(1);
      expect(fx.members).toHaveLength(2); // la fila residual se conserva

      fx.directory.setActive(ORG, ['user-1', 'user-2']);
      const reactivated = await fx.service.listMembers('team-1', ADMIN);
      expect(reactivated.items.map((item) => [item.userId, item.level])).toEqual([
        ['user-1', 'read'],
        ['user-2', 'write'],
      ]);
    });
  });

  describe('Escenario 9: Auditoría', () => {
    it('cada operación registra su acción con team como recurso, sin nombre ni datos personales', async () => {
      const fx = buildFixture();
      fx.directory.setActive(ORG, ['user-1']);

      const created = await fx.service.createTeam({ name: 'Ventas' }, ADMIN);
      await fx.service.addMember(created.id, { userId: 'user-1', level: 'read' }, ADMIN);
      await fx.service.changeMemberLevel(created.id, 'user-1', { level: 'write' }, ADMIN);
      await fx.service.removeMember(created.id, 'user-1', ADMIN);

      const expected = [AuditAction.TEAM_CREATED, AuditAction.TEAM_MEMBER_ADDED, AuditAction.TEAM_MEMBER_LEVEL_CHANGED, AuditAction.TEAM_MEMBER_REMOVED];
      expect(fx.logEvent.mock.calls.map(([event]) => event.action)).toEqual(expected);
      for (const [event] of fx.logEvent.mock.calls) {
        expect(Object.keys(event).sort()).toEqual(['action', 'actorId', 'organizationId', 'resourceId', 'resourceType']);
        expect(event).toMatchObject({ organizationId: ORG, actorId: ADMIN.userId, resourceType: AuditResource.TEAM, resourceId: created.id });
        expect(JSON.stringify(event)).not.toContain('Ventas');
        expect(JSON.stringify(event)).not.toContain('user-1@example.com');
      }
    });

    it('si el registro de auditoría rechaza, la operación no falla', async () => {
      const fx = buildFixture();
      fx.logEvent.mockRejectedValue(new Error('auditoría caída'));

      await expect(fx.service.createTeam({ name: 'Ventas' }, ADMIN)).resolves.toEqual(
        expect.objectContaining({ name: 'Ventas' }),
      );
    });
  });

  describe('teamLevelOf (regla de myLevel, reutilizada por SPEC-222)', () => {
    it('tenant_admin es write con o sin fila de miembro', () => {
      expect(teamLevelOf(Role.TENANT_ADMIN, undefined)).toBe('write');
      expect(teamLevelOf(Role.TENANT_ADMIN, 'read')).toBe('write');
    });

    it('colaborador recibe el nivel de su fila, o null sin fila', () => {
      expect(teamLevelOf(Role.COLABORADOR, 'read')).toBe('read');
      expect(teamLevelOf(Role.COLABORADOR, 'write')).toBe('write');
      expect(teamLevelOf(Role.COLABORADOR, undefined)).toBeNull();
    });
  });

  it('expone los errores de equipos con su código', () => {
    expect(TeamErrors.nameConflict().getResponse()).toEqual(expect.objectContaining({ code: 'TEAM_NAME_CONFLICT' }));
    expect(TeamErrors.memberExists().getResponse()).toEqual(expect.objectContaining({ code: 'TEAM_MEMBER_EXISTS' }));
    expect(TeamErrors.userNotInOrganization().getResponse()).toEqual(
      expect.objectContaining({ code: 'USER_NOT_IN_ORGANIZATION' }),
    );
  });
});
