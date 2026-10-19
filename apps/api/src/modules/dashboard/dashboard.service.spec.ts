import { DashboardService } from './dashboard.service';

const ORG = 'org-1';
const ORG_NAME = 'Acme';

function build(options: { subscription: unknown; used: bigint; limit?: bigint }) {
  const billing = {
    getSubscription: jest.fn().mockResolvedValue(options.subscription),
    getStorageLimitBytes: jest.fn().mockResolvedValue(options.limit ?? 0n),
  };
  const usage = { getUsedStorageBytes: jest.fn().mockResolvedValue(options.used) };
  const service = new DashboardService(billing as never, usage);
  return { service, billing, usage };
}

describe('DashboardService', () => {
  it('agrega plan, límite y uso en bytes para la organización autenticada', async () => {
    const expiresAt = new Date('2026-11-01T00:00:00.000Z');
    const { service, billing, usage } = build({
      subscription: { plan: { id: 'plan-1', name: 'Demo', maxMembers: 5 }, expiresAt },
      used: 1024n,
      limit: 5368709120n,
    });

    const summary = await service.getSummary(ORG_NAME, ORG);

    expect(summary).toEqual({
      organizationName: ORG_NAME,
      plan: {
        id: 'plan-1',
        name: 'Demo',
        storageLimitBytes: 5368709120,
        userLimit: 5,
        expiresAt: expiresAt.toISOString(),
        simulated: true,
      },
      storageUsedBytes: 1024,
      storageLimitBytes: 5368709120,
      recentActivity: [],
    });
    expect(billing.getSubscription).toHaveBeenCalledWith(ORG);
    expect(usage.getUsedStorageBytes).toHaveBeenCalledWith(ORG);
  });

  it('no inventa un límite cuando la organización no tiene suscripción', async () => {
    const { service, billing } = build({ subscription: null, used: 0n });

    const summary = await service.getSummary(ORG_NAME, ORG);

    expect(summary.plan).toBeNull();
    expect(summary.storageLimitBytes).toBe(0);
    expect(billing.getStorageLimitBytes).not.toHaveBeenCalled();
  });

  it('deja recentActivity vacío mientras no exista un módulo de auditoría', async () => {
    const { service } = build({ subscription: null, used: 0n });
    expect((await service.getSummary(ORG_NAME, ORG)).recentActivity).toEqual([]);
  });
});
