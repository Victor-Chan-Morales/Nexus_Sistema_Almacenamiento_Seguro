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
  return { service: new PlatformAdminService({ query } as never), query };
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
