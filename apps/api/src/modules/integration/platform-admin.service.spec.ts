import { BadRequestException, InternalServerErrorException, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Role } from '../iam/domain/enums';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { PlatformAdminService } from './platform-admin.service';

const orgRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'o1',
  name: 'Empresa SA',
  status: 'active',
  deploymentModel: 'cloud',
  planName: 'Demo',
  usedBytes: '1500000000',
  storageLimitBytes: '5000000000',
  memberCount: '3',
  createdAt: new Date('2026-10-01T10:00:00Z'),
  total: '7',
  ...overrides,
});

const build = (responses: unknown[][]) => {
  const query = jest.fn();
  for (const response of responses) query.mockResolvedValueOnce(response);
  return { service: new PlatformAdminService({ query } as never, {} as never, {} as never, {} as never), query };
};

describe('PlatformAdminService.listOrganizations', () => {
  it('Escenario 3: devuelve nombre, estado, modelo, plan, uso, límite, miembros y alta, con tipos numéricos', async () => {
    const { service } = build([[orgRow()]]);
    const page = await service.listOrganizations(20, 0);
    expect(page).toEqual({
      items: [{
        id: 'o1', name: 'Empresa SA', status: 'active', deploymentModel: 'cloud', planName: 'Demo',
        usedBytes: 1_500_000_000, storageLimitBytes: 5_000_000_000, memberCount: 3,
        createdAt: '2026-10-01T10:00:00.000Z',
      }],
      total: 7,
    });
  });

  it('Escenario 3: nunca incluye correos, nombres de personas ni nombres de archivo', async () => {
    const { service, query } = build([[orgRow({ email: 'x@y.co', fileName: 'secreto.pdf', fullName: 'Ana' })]]);
    const page = await service.listOrganizations(20, 0);

    // El resultado solo tiene las claves del contrato, aunque la fila trajera más
    expect(Object.keys(page.items[0]).sort()).toEqual([
      'createdAt', 'deploymentModel', 'id', 'memberCount', 'name', 'planName', 'status', 'storageLimitBytes', 'usedBytes',
    ]);
    expect(JSON.stringify(page)).not.toMatch(/x@y\.co|secreto\.pdf|Ana|email/i);

    // Y la consulta ni siquiera toca las tablas de personas ni de archivos
    const sql = query.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/email|full_name|iam\."user"|files\.file|file_name|password/i);
    expect(sql).not.toMatch(/SELECT\s+\*/i);
  });

  it('una sola consulta con agregados: sin N+1 por organización', async () => {
    const { service, query } = build([[orgRow({ id: 'a' }), orgRow({ id: 'b' }), orgRow({ id: 'c' })]]);
    await service.listOrganizations(20, 0);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([20, 0]); // límite y desplazamiento como parámetros
  });

  it('organización sin suscripción vigente: plan y límite en null, uso 0', async () => {
    const { service } = build([[orgRow({ planName: null, storageLimitBytes: null, usedBytes: '0' })]]);
    const [item] = (await service.listOrganizations(20, 0)).items;
    expect(item).toMatchObject({ planName: null, storageLimitBytes: null, usedBytes: 0 });
  });

  it('página vacía con desplazamiento: cuenta el total aparte', async () => {
    const { service, query } = build([[], [{ total: '7' }]]);
    expect(await service.listOrganizations(20, 100)).toEqual({ items: [], total: 7 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('el SQL usa la vigencia de Billing y los GB decimales del plan', async () => {
    const { service, query } = build([[orgRow()]]);
    await service.listOrganizations(20, 0);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toMatch(/s\.status = 'active'/);
    expect(sql).toMatch(/s\.end_date IS NULL OR s\.end_date > \(now\(\) AT TIME ZONE 'UTC'\)::date/);
    expect(sql).toMatch(/storage_limit_gb::bigint \* 1000000000/);
    expect(sql).toMatch(/m\.status = 'active'/);
  });
});

describe('PlatformAdminService.getMetrics', () => {
  it('Escenario 4: organizaciones por estado, usuarios activos, bytes usados y suscripciones por plan', async () => {
    const { service } = build([
      [{ active: '5', suspended: '1', cancelled: '2', active_users: '12', used_bytes: '9000000000' }],
      [{ planName: 'Demo', count: '4' }, { planName: 'Team', count: '1' }],
    ]);
    expect(await service.getMetrics()).toEqual({
      organizations: { active: 5, suspended: 1, cancelled: 2 },
      activeUsers: 12,
      usedBytes: 9_000_000_000,
      subscriptionsByPlan: [{ planName: 'Demo', count: 4 }, { planName: 'Team', count: 1 }],
    });
  });

  it('Escenario 4: sin datos devuelve ceros y lista vacía', async () => {
    const { service } = build([
      [{ active: '0', suspended: '0', cancelled: '0', active_users: '0', used_bytes: '0' }],
      [],
    ]);
    const metrics = await service.getMetrics();
    expect(metrics.organizations).toEqual({ active: 0, suspended: 0, cancelled: 0 });
    expect(metrics.subscriptionsByPlan).toEqual([]);
  });

  it('las consultas son de solo lectura y no exponen datos personales', async () => {
    const { service, query } = build([
      [{ active: '1', suspended: '0', cancelled: '0', active_users: '1', used_bytes: '0' }],
      [],
    ]);
    await service.getMetrics();
    for (const [sql] of query.mock.calls as Array<[string]>) {
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
      expect(sql).not.toMatch(/email|full_name|password|file_name/i);
    }
  });
});

// ── SPEC-504: edición del catálogo ──────────────────────────────────────────

const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const GB = 1_000_000_000;

const actor: AuthUser = {
  userId: 'admin-1',
  organizationId: 'org-interna',
  role: Role.TENANT_ADMIN,
  email: 'admin@ejemplo.test',
  fullName: 'Super Admin',
  organizationName: 'Organización interna',
  isSuperAdmin: true,
};

/** Plan tal como lo entrega Billing: precio en centavos y almacenamiento en bytes (string). */
const storedPlan = (overrides: Record<string, unknown> = {}) => ({
  id: PLAN_ID,
  name: 'Team',
  description: 'Plan de equipo',
  priceCents: 1999,
  storageLimitBytes: String(200 * GB),
  maxMembers: 10,
  validityDays: null,
  ...overrides,
});

/** Igual que billing.applyPlanChanges: solo cuentan los campos definidos. */
const applyDefined = (current: Record<string, unknown>, changes: Record<string, unknown>) => ({
  ...current,
  ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)),
});

const usage = (bytes: number) => ({ usedBytes: BigInt(bytes), reservedBytes: 0n, totalBytes: BigInt(bytes) });

const buildUpdate = (subscribers: string[] = [], plan: Record<string, unknown> = storedPlan()) => {
  const tx = {
    query: jest.fn().mockResolvedValue(subscribers.map((organizationId) => ({ organizationId }))),
  };
  const dataSource = { transaction: jest.fn((work: (manager: typeof tx) => Promise<unknown>) => work(tx)) };
  const billing = {
    lockPlanForUpdate: jest.fn().mockResolvedValue(plan),
    applyPlanChanges: jest.fn(async (_manager: unknown, current: Record<string, unknown>, changes: Record<string, unknown>) =>
      applyDefined(current, changes),
    ),
  };
  const files = { getTotalStorageUsage: jest.fn().mockResolvedValue(usage(0)) };
  const organizations = { lockById: jest.fn().mockResolvedValue(true) };
  const auditService = { logEvent: jest.fn().mockResolvedValue(undefined) };
  const service = new PlatformAdminService(
    dataSource as never,
    billing as never,
    files as never,
    organizations as never,
    auditService as never,
  );
  return { service, tx, dataSource, billing, files, organizations, auditService };
};

/** Captura la excepción de una promesa rechazada para inspeccionar su respuesta. */
const rejectionOf = (promise: Promise<unknown>): Promise<unknown> => promise.then(() => undefined, (error: unknown) => error);

describe('PlatformAdminService.updatePlan (SPEC-504)', () => {
  beforeEach(() => {
    // La auditoría fallida solo se registra en el log: se silencia el warn para no ensuciar la salida de Jest.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Escenario 1: cambiar solo el precio devuelve el plan en USD y no consulta el uso', async () => {
    const { service, tx, billing, files } = buildUpdate(['org-a']);

    const result = await service.updatePlan(actor, PLAN_ID, { priceMonthly: 24.99 });

    expect(result).toEqual({
      id: PLAN_ID,
      name: 'Team',
      description: 'Plan de equipo',
      priceMonthly: 24.99,
      storageLimitBytes: 200 * GB,
      userLimit: 10,
      validityDays: null,
    });
    expect(billing.applyPlanChanges).toHaveBeenCalledWith(tx, expect.anything(), { priceCents: 2499 });
    expect(tx.query).not.toHaveBeenCalled();
    expect(files.getTotalStorageUsage).not.toHaveBeenCalled();
  });

  it('Escenario 1: subir el límite de almacenamiento no consulta el uso', async () => {
    const { service, tx, billing, files } = buildUpdate(['org-a']);

    const result = await service.updatePlan(actor, PLAN_ID, { storageLimitGb: 300 });

    expect(result.storageLimitBytes).toBe(300 * GB);
    expect(billing.applyPlanChanges).toHaveBeenCalledWith(tx, expect.anything(), { storageLimitBytes: String(300 * GB) });
    expect(tx.query).not.toHaveBeenCalled();
    expect(files.getTotalStorageUsage).not.toHaveBeenCalled();
  });

  it('Escenario 2: bajar el límite con una organización que lo supera responde 422 PLAN_LIMIT_BELOW_USAGE sin escribir', async () => {
    const { service, billing, files, auditService } = buildUpdate(['org-excedida']);
    files.getTotalStorageUsage.mockResolvedValue(usage(150 * GB));

    const error = await rejectionOf(service.updatePlan(actor, PLAN_ID, { storageLimitGb: 120 }));

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    const response = (error as UnprocessableEntityException).getResponse();
    expect(response).toMatchObject({ code: 'PLAN_LIMIT_BELOW_USAGE' });
    expect(JSON.stringify(response)).not.toContain('org-excedida');
    expect(billing.applyPlanChanges).not.toHaveBeenCalled();
    expect(auditService.logEvent).not.toHaveBeenCalled();
  });

  it('Escenario 2: en cuanto una organización supera el nuevo límite no revisa las siguientes', async () => {
    const { service, files } = buildUpdate(['org-a', 'org-b']);
    files.getTotalStorageUsage.mockResolvedValueOnce(usage(150 * GB));

    const error = await rejectionOf(service.updatePlan(actor, PLAN_ID, { storageLimitGb: 120 }));

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(files.getTotalStorageUsage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['menor que el nuevo límite', 100 * GB],
    ['igual al nuevo límite', 120 * GB],
  ])('Escenario 2: bajar el límite con un uso %s responde 200 y escribe', async (_label, usedBytes) => {
    const { service, billing, files } = buildUpdate(['org-a']);
    files.getTotalStorageUsage.mockResolvedValue(usage(usedBytes));

    const result = await service.updatePlan(actor, PLAN_ID, { storageLimitGb: 120 });

    expect(result.storageLimitBytes).toBe(120 * GB);
    expect(billing.applyPlanChanges).toHaveBeenCalledTimes(1);
  });

  it('Escenario 2: si el uso no se puede leer responde 500 FILES_SERVICE_UNAVAILABLE y no escribe', async () => {
    const { service, billing, files, auditService } = buildUpdate(['org-a']);
    files.getTotalStorageUsage.mockRejectedValue(new Error('timeout hacia files'));

    const error = await rejectionOf(service.updatePlan(actor, PLAN_ID, { storageLimitGb: 120 }));

    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect((error as InternalServerErrorException).getResponse()).toMatchObject({ code: 'FILES_SERVICE_UNAVAILABLE' });
    expect(billing.applyPlanChanges).not.toHaveBeenCalled();
    expect(auditService.logEvent).not.toHaveBeenCalled();
  });

  it('Escenario 2: bloquea las organizaciones suscritas en el orden de organization_id devuelto por la consulta', async () => {
    const { service, tx, files, organizations } = buildUpdate(['org-a', 'org-b']);

    await service.updatePlan(actor, PLAN_ID, { storageLimitGb: 120 });

    expect(organizations.lockById.mock.calls.map(([, id]) => id)).toEqual(['org-a', 'org-b']);
    expect(organizations.lockById).toHaveBeenNthCalledWith(1, tx, 'org-a', { allowReferences: true });
    expect(files.getTotalStorageUsage.mock.calls.map(([id]) => id)).toEqual(['org-a', 'org-b']);
    expect(tx.query.mock.calls[0][0]).toMatch(/ORDER BY s\.organization_id/);
    expect(tx.query.mock.calls[0][1]).toEqual([PLAN_ID]);
  });

  it('una organización que ya no existe se salta sin leer su uso', async () => {
    const { service, billing, files, organizations } = buildUpdate(['org-desaparecida', 'org-b']);
    organizations.lockById.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await service.updatePlan(actor, PLAN_ID, { storageLimitGb: 120 });

    expect(files.getTotalStorageUsage.mock.calls.map(([id]) => id)).toEqual(['org-b']);
    expect(billing.applyPlanChanges).toHaveBeenCalledTimes(1);
  });

  it('Escenario 3: el plan Demo responde 422 PLAN_NOT_EDITABLE sin consultar suscriptores ni uso', async () => {
    const { service, tx, billing, files, auditService } = buildUpdate(['org-a']);
    billing.lockPlanForUpdate.mockRejectedValue(
      new UnprocessableEntityException({ code: 'PLAN_NOT_EDITABLE', message: 'El plan Demo no se puede editar' }),
    );

    const error = await rejectionOf(service.updatePlan(actor, PLAN_ID, { storageLimitGb: 50 }));

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({ code: 'PLAN_NOT_EDITABLE' });
    expect(tx.query).not.toHaveBeenCalled();
    expect(files.getTotalStorageUsage).not.toHaveBeenCalled();
    expect(billing.applyPlanChanges).not.toHaveBeenCalled();
    expect(auditService.logEvent).not.toHaveBeenCalled();
  });

  it('plan inexistente: el 404 NOT_FOUND de Billing se propaga sin más consultas', async () => {
    const { service, tx, billing, files } = buildUpdate(['org-a']);
    billing.lockPlanForUpdate.mockRejectedValue(
      new NotFoundException({ code: 'NOT_FOUND', message: 'El plan solicitado no existe' }),
    );

    const error = await rejectionOf(service.updatePlan(actor, PLAN_ID, { priceMonthly: 10 }));

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({ code: 'NOT_FOUND' });
    expect(tx.query).not.toHaveBeenCalled();
    expect(files.getTotalStorageUsage).not.toHaveBeenCalled();
  });

  it('un cuerpo sin ningún campo responde 400 VALIDATION_ERROR antes de abrir la transacción', async () => {
    const { service, dataSource, auditService } = buildUpdate();

    const error = await rejectionOf(service.updatePlan(actor, PLAN_ID, {}));

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(auditService.logEvent).not.toHaveBeenCalled();
  });

  it('Escenario 6: un cambio correcto registra PLAN_UPDATED con el actor, el recurso plan y el plan', async () => {
    const { service, auditService } = buildUpdate();

    await service.updatePlan(actor, PLAN_ID, { priceMonthly: 24.99 });

    expect(auditService.logEvent).toHaveBeenCalledTimes(1);
    expect(auditService.logEvent).toHaveBeenCalledWith({
      organizationId: 'org-interna',
      actorId: 'admin-1',
      action: 'PLAN_UPDATED',
      resourceType: 'plan',
      resourceId: PLAN_ID,
    });
  });

  it('Escenario 6: si la auditoría rechaza, updatePlan responde con el plan igualmente y avisa en el log', async () => {
    const { service, auditService } = buildUpdate();
    auditService.logEvent.mockRejectedValue(new Error('outbox caído'));

    const result = await service.updatePlan(actor, PLAN_ID, { priceMonthly: 24.99 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(result).toMatchObject({ id: PLAN_ID, priceMonthly: 24.99 });
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('Escenario 6: si la auditoría lanza de forma síncrona, la respuesta no cambia', async () => {
    const { service, auditService } = buildUpdate();
    auditService.logEvent.mockImplementation(() => {
      throw new Error('fallo síncrono');
    });

    await expect(service.updatePlan(actor, PLAN_ID, { priceMonthly: 24.99 })).resolves.toMatchObject({ priceMonthly: 24.99 });
  });

  it('mapea storageLimitGb a bytes, userLimit a maxMembers y pasa la descripción tal cual', async () => {
    const { service, tx, billing } = buildUpdate();

    const result = await service.updatePlan(actor, PLAN_ID, {
      storageLimitGb: 150,
      userLimit: 12,
      description: 'Plan actualizado',
    });

    expect(billing.applyPlanChanges).toHaveBeenCalledWith(tx, expect.anything(), {
      storageLimitBytes: '150000000000',
      maxMembers: 12,
      description: 'Plan actualizado',
    });
    expect(result).toMatchObject({ storageLimitBytes: 150 * GB, userLimit: 12, description: 'Plan actualizado' });
  });

  it.each([
    [0.29, 29],
    [24.99, 2499],
    [99999999.99, 9999999999],
  ])('convierte el precio %p USD en %p centavos sin errores de coma flotante', async (priceMonthly, priceCents) => {
    const { service, tx, billing } = buildUpdate();

    await service.updatePlan(actor, PLAN_ID, { priceMonthly });

    expect(billing.applyPlanChanges).toHaveBeenCalledWith(tx, expect.anything(), { priceCents });
  });
});
