import { ExecutionContext, ForbiddenException, INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';
import { ROLES_KEY } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { RolesGuard } from '../iam/guards/roles.guard';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

/**
 * SPEC-220: rutas de equipos por HTTP y autorización por rol (escenario 7). Usa el controlador real con las pipes
 * de Nest, el filtro de errores del proyecto y el RolesGuard real; el servicio va simulado y el guard JWT se
 * sustituye por uno que deja pasar. El rol de la petición llega en la cabecera de prueba `x-test-role`.
 */

const ORG = 'org-1';
const USER = 'user-1';
const TEAM_ID = '55555555-5555-4555-8555-555555555555';
const MEMBER_ID = '66666666-6666-4666-8666-666666666666';

/** Rutas de administración: solo tenant_admin. */
const ADMIN_HANDLERS = ['createTeam', 'listMembers', 'addMember', 'changeMemberLevel', 'removeMember'] as const;

const contextFor = (handlerName: string, role: Role): ExecutionContext => {
  const handler = TeamsController.prototype[handlerName as keyof TeamsController] as unknown as () => void;
  return {
    getHandler: () => handler,
    getClass: () => TeamsController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { userId: USER, organizationId: ORG, role } }),
    }),
  } as unknown as ExecutionContext;
};

describe('TeamsController (SPEC-220)', () => {
  describe('Roles por ruta (escenario 7)', () => {
    const reflector = new Reflector();
    const guard = new RolesGuard(reflector);

    it.each(ADMIN_HANDLERS)('%s exige tenant_admin', (handlerName) => {
      const handler = TeamsController.prototype[handlerName as keyof TeamsController] as unknown as () => void;
      expect(reflector.get<Role[]>(ROLES_KEY, handler)).toEqual([Role.TENANT_ADMIN]);
    });

    it('GET /teams no exige rol: lo puede usar cualquier miembro', () => {
      const handler = TeamsController.prototype.listTeams as unknown as () => void;
      expect(reflector.get<Role[] | undefined>(ROLES_KEY, handler)).toBeUndefined();
    });

    it.each(ADMIN_HANDLERS)('%s responde 403 FORBIDDEN_ROLE a un colaborador', (handlerName) => {
      let failure: unknown;
      try {
        guard.canActivate(contextFor(handlerName, Role.COLABORADOR));
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(ForbiddenException);
      expect((failure as ForbiddenException).getResponse()).toEqual(
        expect.objectContaining({ code: 'FORBIDDEN_ROLE' }),
      );
    });

    it.each(ADMIN_HANDLERS)('%s deja pasar a tenant_admin', (handlerName) => {
      expect(guard.canActivate(contextFor(handlerName, Role.TENANT_ADMIN))).toBe(true);
    });

    it('GET /teams deja pasar a cualquier miembro', () => {
      expect(guard.canActivate(contextFor('listTeams', Role.COLABORADOR))).toBe(true);
      expect(guard.canActivate(contextFor('listTeams', Role.TENANT_ADMIN))).toBe(true);
    });
  });

  describe('HTTP', () => {
    let app: INestApplication;
    const teams = {
      createTeam: jest.fn(),
      listTeams: jest.fn(),
      listMembers: jest.fn(),
      addMember: jest.fn(),
      changeMemberLevel: jest.fn(),
      removeMember: jest.fn(),
    };

    beforeAll(async () => {
      const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, TeamsController) ?? [];
      const moduleRef = await Test.createTestingModule({
        controllers: [TeamsController],
        providers: [{ provide: TeamsService, useValue: teams }],
      })
        .overrideGuard(guards[0] as never)
        .useValue({ canActivate: () => true })
        .compile();

      app = moduleRef.createNestApplication();
      app.use((req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
        req.user = {
          userId: USER,
          organizationId: ORG,
          role: req.headers['x-test-role'] ?? Role.TENANT_ADMIN,
          email: 'admin@example.com',
          fullName: 'Admin',
          organizationName: 'Org',
        };
        next();
      });
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      app.useGlobalFilters(new ApiExceptionFilter());
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      jest.clearAllMocks();
      teams.createTeam.mockResolvedValue({ id: TEAM_ID, name: 'Ventas', driveId: 'drive-1', createdAt: '2026-11-06T00:00:00.000Z' });
      teams.listTeams.mockResolvedValue({ items: [] });
      teams.listMembers.mockResolvedValue({ items: [] });
      teams.addMember.mockResolvedValue(undefined);
      teams.changeMemberLevel.mockResolvedValue(undefined);
      teams.removeMember.mockResolvedValue(undefined);
    });

    describe('POST /teams', () => {
      it('crea el equipo con 201 y recorta el nombre antes del servicio', async () => {
        const response = await request(app.getHttpServer()).post('/teams').send({ name: '   Ventas  ' });

        expect(response.status).toBe(201);
        expect(response.body).toEqual(expect.objectContaining({ id: TEAM_ID, name: 'Ventas', driveId: 'drive-1' }));
        expect(teams.createTeam).toHaveBeenCalledWith(
          { name: 'Ventas' },
          { organizationId: ORG, userId: USER, role: Role.TENANT_ADMIN },
        );
      });

      it('nombre vacío o solo espacios → 400 VALIDATION_ERROR', async () => {
        const response = await request(app.getHttpServer()).post('/teams').send({ name: '     ' });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
        expect(teams.createTeam).not.toHaveBeenCalled();
      });

      it('nombre de más de 150 caracteres → 400', async () => {
        const response = await request(app.getHttpServer()).post('/teams').send({ name: 'x'.repeat(151) });
        expect(response.status).toBe(400);
      });

      it('campo no declarado como organizationId → 400: la organización nunca sale del cuerpo', async () => {
        const response = await request(app.getHttpServer())
          .post('/teams')
          .send({ name: 'Ventas', organizationId: 'otra-org' });

        expect(response.status).toBe(400);
        expect(teams.createTeam).not.toHaveBeenCalled();
      });

      it('colaborador → 403 FORBIDDEN_ROLE', async () => {
        const response = await request(app.getHttpServer())
          .post('/teams')
          .set('x-test-role', Role.COLABORADOR)
          .send({ name: 'Ventas' });

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('FORBIDDEN_ROLE');
        expect(teams.createTeam).not.toHaveBeenCalled();
      });
    });

    describe('GET /teams', () => {
      it('colaborador puede listar y recibe su actor con su rol', async () => {
        const response = await request(app.getHttpServer()).get('/teams').set('x-test-role', Role.COLABORADOR);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ items: [] });
        expect(teams.listTeams).toHaveBeenCalledWith({ organizationId: ORG, userId: USER, role: Role.COLABORADOR });
      });
    });

    describe('miembros', () => {
      it('GET /teams/:id/members: admin 200; colaborador 403', async () => {
        const ok = await request(app.getHttpServer()).get(`/teams/${TEAM_ID}/members`);
        const denied = await request(app.getHttpServer())
          .get(`/teams/${TEAM_ID}/members`)
          .set('x-test-role', Role.COLABORADOR);

        expect(ok.status).toBe(200);
        expect(denied.status).toBe(403);
        expect(denied.body.code).toBe('FORBIDDEN_ROLE');
      });

      it('POST /teams/:id/members responde 201 sin cuerpo y pasa el actor derivado de la sesión', async () => {
        const response = await request(app.getHttpServer())
          .post(`/teams/${TEAM_ID}/members`)
          .send({ userId: MEMBER_ID, level: 'read' });

        expect(response.status).toBe(201);
        expect(response.text).toBe('');
        expect(teams.addMember).toHaveBeenCalledWith(
          TEAM_ID,
          { userId: MEMBER_ID, level: 'read' },
          { organizationId: ORG, userId: USER, role: Role.TENANT_ADMIN },
        );
      });

      it('POST con level distinto de read o write → 400', async () => {
        const response = await request(app.getHttpServer())
          .post(`/teams/${TEAM_ID}/members`)
          .send({ userId: MEMBER_ID, level: 'admin' });

        expect(response.status).toBe(400);
        expect(teams.addMember).not.toHaveBeenCalled();
      });

      it('POST con userId que no es UUID → 400', async () => {
        const response = await request(app.getHttpServer())
          .post(`/teams/${TEAM_ID}/members`)
          .send({ userId: 'no-es-uuid', level: 'read' });
        expect(response.status).toBe(400);
      });

      it('id de equipo que no es UUID → 400', async () => {
        const response = await request(app.getHttpServer())
          .post('/teams/no-es-uuid/members')
          .send({ userId: MEMBER_ID, level: 'read' });
        expect(response.status).toBe(400);
      });

      it('POST con campo no declarado → 400', async () => {
        const response = await request(app.getHttpServer())
          .post(`/teams/${TEAM_ID}/members`)
          .send({ userId: MEMBER_ID, level: 'read', organizationId: 'otra-org' });
        expect(response.status).toBe(400);
      });

      it('PATCH cambia el nivel con 200; nivel inválido → 400', async () => {
        const ok = await request(app.getHttpServer())
          .patch(`/teams/${TEAM_ID}/members/${MEMBER_ID}`)
          .send({ level: 'write' });
        const invalid = await request(app.getHttpServer())
          .patch(`/teams/${TEAM_ID}/members/${MEMBER_ID}`)
          .send({ level: 'admin' });

        expect(ok.status).toBe(200);
        expect(teams.changeMemberLevel).toHaveBeenCalledWith(
          TEAM_ID,
          MEMBER_ID,
          { level: 'write' },
          { organizationId: ORG, userId: USER, role: Role.TENANT_ADMIN },
        );
        expect(invalid.status).toBe(400);
      });

      it('DELETE quita al miembro con 204', async () => {
        const response = await request(app.getHttpServer()).delete(`/teams/${TEAM_ID}/members/${MEMBER_ID}`);

        expect(response.status).toBe(204);
        expect(teams.removeMember).toHaveBeenCalledWith(TEAM_ID, MEMBER_ID, {
          organizationId: ORG,
          userId: USER,
          role: Role.TENANT_ADMIN,
        });
      });

      it('colaborador no puede agregar, cambiar ni quitar miembros → 403', async () => {
        const add = await request(app.getHttpServer())
          .post(`/teams/${TEAM_ID}/members`)
          .set('x-test-role', Role.COLABORADOR)
          .send({ userId: MEMBER_ID, level: 'read' });
        const patch = await request(app.getHttpServer())
          .patch(`/teams/${TEAM_ID}/members/${MEMBER_ID}`)
          .set('x-test-role', Role.COLABORADOR)
          .send({ level: 'write' });
        const remove = await request(app.getHttpServer())
          .delete(`/teams/${TEAM_ID}/members/${MEMBER_ID}`)
          .set('x-test-role', Role.COLABORADOR);

        expect([add.status, patch.status, remove.status]).toEqual([403, 403, 403]);
        expect(teams.addMember).not.toHaveBeenCalled();
        expect(teams.changeMemberLevel).not.toHaveBeenCalled();
        expect(teams.removeMember).not.toHaveBeenCalled();
      });
    });
  });
});
