import {
  BadRequestException,
  ExecutionContext,
  INestApplication,
  ParseUUIDPipe,
  UnauthorizedException,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';
import { Role } from '../iam/domain/enums';
import { SuperAdminGuard } from '../iam/guards/super-admin.guard';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { PlatformActionsService } from './platform-actions.service';
import { PlatformAdminService } from './platform-admin.service';
import {
  ApprovePlatformInstallationRequestDto,
  DEFAULT_PAGE_SIZE,
  PlatformController,
  PlatformInstallationRequestsQuery,
  PlatformOrganizationsQuery,
  UpdatePlatformInstallationStatusDto,
  UpdatePlatformPlanDto,
} from './platform.controller';

describe('PlatformController (SPEC-501)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const parse = (query: Record<string, unknown>) =>
    pipe.transform(query, { type: 'query', metatype: PlatformOrganizationsQuery }) as Promise<PlatformOrganizationsQuery>;

  it('Escenario 5: la clase exige sesión JWT y SuperAdminGuard, en ese orden', () => {
    const guards = Reflect.getMetadata('__guards__', PlatformController) as unknown[];
    expect(guards).toHaveLength(2);
    expect(guards[1]).toBe(SuperAdminGuard);
  });

  it('GET /platform/organizations usa los valores por defecto cuando no hay limit ni offset', async () => {
    const platform = { listOrganizations: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
    const controller = new PlatformController(platform as never, {} as never);
    await controller.listOrganizations(await parse({}));
    expect(platform.listOrganizations).toHaveBeenCalledWith(DEFAULT_PAGE_SIZE, 0);
  });

  it('convierte limit y offset de texto a número y los pasa al servicio', async () => {
    const platform = { listOrganizations: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
    const controller = new PlatformController(platform as never, {} as never);
    await controller.listOrganizations(await parse({ limit: '50', offset: '10' }));
    expect(platform.listOrganizations).toHaveBeenCalledWith(50, 10);
  });

  it.each([{ limit: '0' }, { limit: '101' }, { limit: 'abc' }, { offset: '-1' }, { offset: '1.5' }])(
    'rechaza parámetros fuera de rango: %j',
    async (query) => {
      await expect(parse(query)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('Escenario 6 / aislamiento: rechaza cualquier parámetro de organización o rol (forbidNonWhitelisted)', async () => {
    await expect(parse({ organizationId: 'o9' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(parse({ isSuperAdmin: 'true' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('GET /platform/metrics delega en el servicio sin parámetros', async () => {
    const metrics = { organizations: { active: 1, suspended: 0, cancelled: 0 }, activeUsers: 1, usedBytes: 0, subscriptionsByPlan: [] };
    const platform = { getMetrics: jest.fn().mockResolvedValue(metrics) };
    expect(await new PlatformController(platform as never, {} as never).getMetrics()).toBe(metrics);
    expect(PlatformController.prototype.getMetrics.length).toBe(0);
  });
});

/** SPEC-503 §5 y §10: validación de las entradas nuevas con los pipes de producción. */
describe('Validación de las rutas de acciones de plataforma (SPEC-503)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const toBody = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: ApprovePlatformInstallationRequestDto }) as Promise<ApprovePlatformInstallationRequestDto>;

  it('approve sin operatorName es un error de validación', async () => {
    await expect(toBody({ hostReference: 'host-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(toBody({})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approve acepta operatorName de 1 a 150 caracteres y hostReference opcional', async () => {
    await expect(toBody({ operatorName: 'Operador' })).resolves.toMatchObject({ operatorName: 'Operador' });
    await expect(toBody({ operatorName: 'x'.repeat(150) })).resolves.toBeDefined();
    await expect(toBody({ operatorName: 'Operador', hostReference: 'h'.repeat(255) })).resolves.toBeDefined();
  });

  it.each([
    { operatorName: '' },
    { operatorName: 'x'.repeat(151) },
    { operatorName: 'Operador', hostReference: 'h'.repeat(256) },
    { operatorName: 'Operador', organizationId: 'org-2' },
  ])('approve rechaza el cuerpo inválido: %j', async (body) => {
    await expect(toBody(body)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['Pendiente', 'Operativa', 'Fallida', 'No solicitada', 'En proceso'])(
    'PATCH acepta el estado de instalación %s',
    async (status) => {
      const dto = await pipe.transform({ status }, { type: 'body', metatype: UpdatePlatformInstallationStatusDto });
      expect(dto).toMatchObject({ status });
    },
  );

  it('PATCH rechaza un estado que no pertenece al enum', async () => {
    await expect(
      pipe.transform({ status: 'Inventado' }, { type: 'body', metatype: UpdatePlatformInstallationStatusDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['Pendiente', 'Aprobada', 'Rechazada', 'Cerrada'])('GET installation-requests acepta status=%s', async (status) => {
    await expect(
      pipe.transform({ status }, { type: 'query', metatype: PlatformInstallationRequestsQuery }),
    ).resolves.toMatchObject({ status });
  });

  it.each([{ status: 'Activa' }, { status: '' }, { status: ['Pendiente', 'Aprobada'] }, { organizationId: 'org-2' }])(
    'GET installation-requests rechaza la query inválida: %j',
    async (query) => {
      await expect(
        pipe.transform(query, { type: 'query', metatype: PlatformInstallationRequestsQuery }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});

/**
 * SPEC-503 E9 y §10 por HTTP: rutas, códigos, delegación y guardas reales (SuperAdminGuard) con los pipes y el
 * filtro de producción. Solo el guard JWT se sustituye: simula sesión o ausencia de ella.
 */
describe('Rutas de acciones de plataforma (SPEC-503) por HTTP', () => {
  let app: INestApplication;
  /** null simula una petición sin sesión (401). */
  let currentUser: AuthUser | null;

  const ORG_ID = '11111111-1111-4111-8111-111111111111';
  const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
  const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';
  const NOT_A_UUID = 'no-es-un-uuid';

  const superAdmin: AuthUser = {
    userId: 'admin-1',
    organizationId: 'org-interna',
    role: Role.TENANT_ADMIN,
    email: 'admin@ejemplo.test',
    fullName: 'Super Admin',
    organizationName: 'Organización interna',
    isSuperAdmin: true,
  };

  const platform = { listOrganizations: jest.fn(), getMetrics: jest.fn(), updatePlan: jest.fn() };
  const actions = {
    suspendOrganization: jest.fn(),
    reactivateOrganization: jest.fn(),
    listInstallationRequests: jest.fn(),
    approveInstallationRequest: jest.fn(),
    rejectInstallationRequest: jest.fn(),
    updateInstallationStatus: jest.fn(),
  };

  /** El guard JWT es el mixin de AuthGuard('jwt') declarado en la clase; se sustituye por el ID de esa referencia. */
  const jwtGuard = (Reflect.getMetadata('__guards__', PlatformController) as unknown[])[0] as new () => unknown;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PlatformController],
      providers: [
        { provide: PlatformAdminService, useValue: platform },
        { provide: PlatformActionsService, useValue: actions },
      ],
    })
      .overrideGuard(jwtGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          if (!currentUser) throw new UnauthorizedException();
          context.switchToHttp().getRequest().user = currentUser;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    currentUser = superAdmin;
  });

  const http = () => request(app.getHttpServer());

  const writeRoutes: Array<{ name: string; method: 'post' | 'patch'; path: (id: string) => string; body?: object }> = [
    { name: 'suspend', method: 'post', path: (id) => `/platform/organizations/${id}/suspend` },
    { name: 'reactivate', method: 'post', path: (id) => `/platform/organizations/${id}/reactivate` },
    { name: 'approve', method: 'post', path: (id) => `/platform/installation-requests/${id}/approve`, body: { operatorName: 'Operador' } },
    { name: 'reject', method: 'post', path: (id) => `/platform/installation-requests/${id}/reject` },
    { name: 'PATCH installation', method: 'patch', path: (id) => `/platform/installations/${id}`, body: { status: 'En proceso' } },
  ];

  describe('E9: sin sesión o sin Super Admin, las seis rutas responden antes de tocar el servicio', () => {
    const allRoutes = [
      { method: 'post' as const, path: `/platform/organizations/${ORG_ID}/suspend` },
      { method: 'post' as const, path: `/platform/organizations/${ORG_ID}/reactivate` },
      { method: 'get' as const, path: '/platform/installation-requests' },
      { method: 'post' as const, path: `/platform/installation-requests/${REQUEST_ID}/approve` },
      { method: 'post' as const, path: `/platform/installation-requests/${REQUEST_ID}/reject` },
      { method: 'patch' as const, path: `/platform/installations/${INSTALLATION_ID}` },
      { method: 'patch' as const, path: `/platform/plans/${INSTALLATION_ID}` },
    ];

    it.each(allRoutes)('$method $path sin sesión responde 401 UNAUTHORIZED', async ({ method, path }) => {
      currentUser = null;
      const res = await http()[method](path).send({ operatorName: 'Operador', status: 'En proceso' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(Object.values(actions).every((fn) => fn.mock.calls.length === 0)).toBe(true);
    });

    it.each(allRoutes)('$method $path sin Super Admin responde 403 PLATFORM_ADMIN_REQUIRED', async ({ method, path }) => {
      currentUser = { ...superAdmin, isSuperAdmin: false };
      const res = await http()[method](path).send({ operatorName: 'Operador', status: 'En proceso' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLATFORM_ADMIN_REQUIRED');
      expect(Object.values(actions).every((fn) => fn.mock.calls.length === 0)).toBe(true);
    });
  });

  it('POST suspend delega con el actor de la sesión y el :id, y responde 200', async () => {
    actions.suspendOrganization.mockResolvedValue({ id: ORG_ID, status: 'suspended' });
    const res = await http().post(`/platform/organizations/${ORG_ID}/suspend`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: ORG_ID, status: 'suspended' });
    expect(actions.suspendOrganization).toHaveBeenCalledWith(superAdmin, ORG_ID);
  });

  it('POST reactivate delega y responde 200', async () => {
    actions.reactivateOrganization.mockResolvedValue({ id: ORG_ID, status: 'active' });
    const res = await http().post(`/platform/organizations/${ORG_ID}/reactivate`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: ORG_ID, status: 'active' });
    expect(actions.reactivateOrganization).toHaveBeenCalledWith(superAdmin, ORG_ID);
  });

  it('un error de transición del servicio llega con su código de negocio (422)', async () => {
    actions.suspendOrganization.mockRejectedValue(
      new UnprocessableEntityException({
        code: 'CANNOT_SUSPEND_OWN_ORGANIZATION',
        message: 'No se puede suspender la organización interna del Super Admin',
      }),
    );
    const res = await http().post(`/platform/organizations/${ORG_ID}/suspend`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CANNOT_SUSPEND_OWN_ORGANIZATION');
  });

  it('GET installation-requests sin status delega con undefined y responde 200', async () => {
    actions.listInstallationRequests.mockResolvedValue({ items: [] });
    const res = await http().get('/platform/installation-requests');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
    expect(actions.listInstallationRequests).toHaveBeenCalledWith(undefined);
  });

  it('GET installation-requests?status=Pendiente delega con el filtro', async () => {
    actions.listInstallationRequests.mockResolvedValue({ items: [] });
    const res = await http().get('/platform/installation-requests?status=Pendiente');
    expect(res.status).toBe(200);
    expect(actions.listInstallationRequests).toHaveBeenCalledWith('Pendiente');
  });

  it('GET installation-requests con un status fuera de la lista responde 400 VALIDATION_ERROR', async () => {
    const res = await http().get('/platform/installation-requests?status=Activa');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(actions.listInstallationRequests).not.toHaveBeenCalled();
  });

  it('GET installation-requests no acepta organizationId del cliente', async () => {
    const res = await http().get(`/platform/installation-requests?organizationId=${ORG_ID}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(actions.listInstallationRequests).not.toHaveBeenCalled();
  });

  it('POST approve delega con el cuerpo validado y responde 200', async () => {
    actions.approveInstallationRequest.mockResolvedValue({ requestId: REQUEST_ID, installationId: INSTALLATION_ID });
    const res = await http()
      .post(`/platform/installation-requests/${REQUEST_ID}/approve`)
      .send({ operatorName: 'Operador', hostReference: 'host-01' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requestId: REQUEST_ID, installationId: INSTALLATION_ID });
    expect(actions.approveInstallationRequest).toHaveBeenCalledWith(superAdmin, REQUEST_ID, {
      operatorName: 'Operador',
      hostReference: 'host-01',
    });
  });

  it('POST approve sin operatorName responde 400 y no llama al servicio', async () => {
    const res = await http().post(`/platform/installation-requests/${REQUEST_ID}/approve`).send({ hostReference: 'h' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(actions.approveInstallationRequest).not.toHaveBeenCalled();
  });

  it.each([
    { operatorName: 'x'.repeat(151) },
    { operatorName: 'Operador', hostReference: 'h'.repeat(256) },
    { operatorName: 'Operador', organizationId: ORG_ID },
  ])('POST approve rechaza el cuerpo inválido %j con 400', async (body) => {
    const res = await http().post(`/platform/installation-requests/${REQUEST_ID}/approve`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(actions.approveInstallationRequest).not.toHaveBeenCalled();
  });

  it('POST reject delega y responde 200', async () => {
    actions.rejectInstallationRequest.mockResolvedValue({ requestId: REQUEST_ID, status: 'Rechazada' });
    const res = await http().post(`/platform/installation-requests/${REQUEST_ID}/reject`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requestId: REQUEST_ID, status: 'Rechazada' });
    expect(actions.rejectInstallationRequest).toHaveBeenCalledWith(superAdmin, REQUEST_ID);
  });

  it('PATCH installations delega el status y responde 200', async () => {
    actions.updateInstallationStatus.mockResolvedValue({ id: INSTALLATION_ID, status: 'En proceso' });
    const res = await http().patch(`/platform/installations/${INSTALLATION_ID}`).send({ status: 'En proceso' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: INSTALLATION_ID, status: 'En proceso' });
    expect(actions.updateInstallationStatus).toHaveBeenCalledWith(superAdmin, INSTALLATION_ID, 'En proceso');
  });

  it('PATCH installations con un status fuera del enum responde 400 y no llama al servicio', async () => {
    const res = await http().patch(`/platform/installations/${INSTALLATION_ID}`).send({ status: 'Inventado' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(actions.updateInstallationStatus).not.toHaveBeenCalled();
  });

  it('una transición no válida llega como 422 del servicio, sin validación del controlador', async () => {
    actions.updateInstallationStatus.mockRejectedValue(
      new UnprocessableEntityException({
        code: 'INVALID_INSTALLATION_TRANSITION',
        message: 'La transición de estado de la instalación no está permitida',
      }),
    );
    const res = await http().patch(`/platform/installations/${INSTALLATION_ID}`).send({ status: 'Operativa' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_INSTALLATION_TRANSITION');
  });

  describe('el :id debe ser un UUID', () => {
    it.each(writeRoutes)('$name responde 400 con un id que no es UUID', async ({ method, path, body }) => {
      const req = http()[method](path(NOT_A_UUID));
      const res = await (body ? req.send(body) : req);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(Object.values(actions).every((fn) => fn.mock.calls.length === 0)).toBe(true);
    });
  });

  it('las rutas existentes siguen respondiendo', async () => {
    platform.getMetrics.mockResolvedValue({ organizations: { active: 1, suspended: 0, cancelled: 0 } });
    const res = await http().get('/platform/metrics');
    expect(res.status).toBe(200);
    expect(platform.getMetrics).toHaveBeenCalledTimes(1);
  });

  describe('PATCH /platform/plans/:id (SPEC-504) por HTTP', () => {
    const PLAN_ID = '55555555-5555-4555-8555-555555555555';
    const planPath = `/platform/plans/${PLAN_ID}`;

    it('delega el cuerpo validado con el actor de la sesión y responde 200 con el plan', async () => {
      const plan = {
        id: PLAN_ID,
        name: 'Team',
        description: 'Plan de equipo',
        priceMonthly: 24.99,
        storageLimitBytes: 150000000000,
        userLimit: 10,
        validityDays: null,
      };
      platform.updatePlan.mockResolvedValue(plan);

      const res = await http().patch(planPath).send({ priceMonthly: 24.99, description: ' Texto ' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(plan);
      expect(platform.updatePlan).toHaveBeenCalledWith(superAdmin, PLAN_ID, { priceMonthly: 24.99, description: 'Texto' });
    });

    it.each([
      { priceMonthly: 1.005 },
      { storageLimitGb: 0 },
      { userLimit: '12' },
      { description: null },
      { organizationId: ORG_ID },
    ])('cuerpo inválido %j: responde 400 VALIDATION_ERROR y no llama al servicio', async (body) => {
      const res = await http().patch(planPath).send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(platform.updatePlan).not.toHaveBeenCalled();
    });

    it('un :id que no es UUID responde 400 y no llama al servicio', async () => {
      const res = await http().patch(`/platform/plans/${NOT_A_UUID}`).send({ priceMonthly: 10 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(platform.updatePlan).not.toHaveBeenCalled();
    });

    it('un error de negocio del servicio llega con su código (422 PLAN_NOT_EDITABLE)', async () => {
      platform.updatePlan.mockRejectedValue(
        new UnprocessableEntityException({ code: 'PLAN_NOT_EDITABLE', message: 'El plan Demo no se puede editar' }),
      );
      const res = await http().patch(planPath).send({ priceMonthly: 10 });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PLAN_NOT_EDITABLE');
    });
  });
});

/** SPEC-504: validación de PATCH /platform/plans/:id con el mismo ValidationPipe de producción. */
describe('PATCH /platform/plans/:id (SPEC-504): DTO y ruta', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const toPlanDto = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: UpdatePlatformPlanDto }) as Promise<UpdatePlatformPlanDto>;

  const PLAN_ID = '44444444-4444-4444-8444-444444444444';
  const actor: AuthUser = {
    userId: 'admin-1',
    organizationId: 'org-interna',
    role: Role.TENANT_ADMIN,
    email: 'admin@ejemplo.test',
    fullName: 'Super Admin',
    organizationName: 'Organización interna',
    isSuperAdmin: true,
  };

  it.each([
    { priceMonthly: -1 },
    { priceMonthly: 1.005 },
    { priceMonthly: '24.99' },
    { storageLimitGb: 0 },
    { storageLimitGb: 1.5 },
    { storageLimitGb: 2147483648 },
    { userLimit: '12' },
    { userLimit: 0 },
    { description: '' },
    { description: '   ' },
    { description: 'x'.repeat(501) },
    { organizationId: 'org-2' },
    { priceMonthly: null },
    { storageLimitGb: null },
    { userLimit: null },
    { description: null },
  ])('rechaza el cuerpo inválido %j con 400', async (body) => {
    await expect(toPlanDto(body)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('acepta los valores válidos y recorta la descripción', async () => {
    await expect(toPlanDto({ priceMonthly: 24.99, storageLimitGb: 150, description: ' Texto ' })).resolves.toMatchObject({
      priceMonthly: 24.99,
      storageLimitGb: 150,
      description: 'Texto',
    });
    await expect(toPlanDto({ priceMonthly: 0, storageLimitGb: 1, userLimit: 2147483647 })).resolves.toMatchObject({
      priceMonthly: 0,
      storageLimitGb: 1,
      userLimit: 2147483647,
    });
    await expect(toPlanDto({ priceMonthly: 99999999.99, description: 'x'.repeat(500) })).resolves.toBeDefined();
  });

  it('un cuerpo sin campos pasa el DTO: que haya al menos un cambio lo exige el servicio', async () => {
    await expect(toPlanDto({})).resolves.toEqual({});
  });

  it('PlatformController.updatePlan delega en platform.updatePlan con el actor, el id y el cuerpo', async () => {
    const plan = { id: PLAN_ID, name: 'Team', description: 'Plan de equipo', priceMonthly: 24.99 };
    const platform = { updatePlan: jest.fn().mockResolvedValue(plan) };
    const controller = new PlatformController(platform as never, {} as never);
    const body = { priceMonthly: 24.99 };

    expect(await controller.updatePlan(actor, PLAN_ID, body)).toBe(plan);
    expect(platform.updatePlan).toHaveBeenCalledWith(actor, PLAN_ID, body);
  });

  it('el :id de PATCH /platform/plans/:id pasa por ParseUUIDPipe: un UUID válido sí, otro valor no', async () => {
    const idPipe = new ParseUUIDPipe();
    const param = { type: 'param' as const, metatype: String, data: 'id' };
    await expect(idPipe.transform(PLAN_ID, param)).resolves.toBe(PLAN_ID);
    await expect(idPipe.transform('no-es-un-uuid', param)).rejects.toBeInstanceOf(BadRequestException);
  });
});
