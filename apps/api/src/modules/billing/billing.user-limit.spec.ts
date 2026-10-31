import { MemberAdmission } from '../iam/member-admission';
import { UserLimitHook } from './registration/user-limit.hook';

const build = (subscription: unknown) => {
  const billing = { getActiveSubscriptionReadOnly: jest.fn().mockResolvedValue(subscription) };
  const admission = new MemberAdmission();
  new UserLimitHook(admission, billing as never).onModuleInit();
  return { admission, billing };
};

describe('UserLimitHook (fuente del límite de usuarios para IAM)', () => {
  it('devuelve plan.maxMembers de la suscripción vigente de la organización', async () => {
    const t = build({ plan: { maxMembers: 5 } });
    expect(await t.admission.userLimit('ORG-1')).toBe(5);
    expect(t.billing.getActiveSubscriptionReadOnly).toHaveBeenCalledWith('ORG-1');
  });

  it('sin suscripción vigente devuelve null (IAM falla cerrado)', async () => {
    expect(await build(null).admission.userLimit('ORG-1')).toBeNull();
  });

  it('suscripción sin plan cargado también devuelve null', async () => {
    expect(await build({ plan: undefined }).admission.userLimit('ORG-1')).toBeNull();
  });

  it('un plan con 0 miembros devuelve 0, no null', async () => {
    expect(await build({ plan: { maxMembers: 0 } }).admission.userLimit('ORG-1')).toBe(0);
  });

  it('registrar el hook dos veces no duplica ni rompe la fuente', async () => {
    const t = build({ plan: { maxMembers: 10 } });
    new UserLimitHook(t.admission, t.billing as never).onModuleInit();
    expect(await t.admission.userLimit('ORG-1')).toBe(10);
  });
});
