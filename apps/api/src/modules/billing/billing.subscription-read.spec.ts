import { BillingService } from './billing.service';
import { SubscriptionStatus } from './entities/subscription.entity';

const DAY = 24 * 60 * 60 * 1000;

const build = (sub: unknown) => {
  const subscriptionRepo = {
    findOne: jest.fn().mockResolvedValue(sub),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const service = new BillingService({} as never, subscriptionRepo as never, {} as never);
  return { service, subscriptionRepo };
};

describe('BillingService.getActiveSubscriptionReadOnly (lectura sin escritura)', () => {
  it('devuelve la suscripción vigente sin escribir nada', async () => {
    const sub = { id: 's1', status: SubscriptionStatus.ACTIVE, expiresAt: new Date(Date.now() + 30 * DAY), plan: { maxMembers: 5 } };
    const t = build(sub);
    expect(await t.service.getActiveSubscriptionReadOnly('ORG-1')).toBe(sub);
    expect(t.subscriptionRepo.save).not.toHaveBeenCalled();
  });

  it('una suscripción vencida devuelve null sin marcarla como EXPIRED (no escribe)', async () => {
    const sub = { id: 's1', status: SubscriptionStatus.ACTIVE, expiresAt: new Date(Date.now() - 2 * DAY), plan: { maxMembers: 5 } };
    const t = build(sub);
    expect(await t.service.getActiveSubscriptionReadOnly('ORG-1')).toBeNull();
    expect(t.subscriptionRepo.save).not.toHaveBeenCalled();
    expect(sub.status).toBe(SubscriptionStatus.ACTIVE);
  });

  it('sin suscripción activa devuelve null', async () => {
    const t = build(null);
    expect(await t.service.getActiveSubscriptionReadOnly('ORG-1')).toBeNull();
    expect(t.subscriptionRepo.save).not.toHaveBeenCalled();
  });

  it('getActiveSubscription sigue marcando como EXPIRED las vencidas (comportamiento anterior intacto)', async () => {
    const sub = { id: 's1', status: SubscriptionStatus.ACTIVE, expiresAt: new Date(Date.now() - 2 * DAY), plan: {} };
    const t = build(sub);
    expect(await t.service.getActiveSubscription('ORG-1')).toBeNull();
    expect(t.subscriptionRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: SubscriptionStatus.EXPIRED }));
  });
});
