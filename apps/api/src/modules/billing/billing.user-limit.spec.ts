import { Test, TestingModule } from '@nestjs/testing';
import { UserLimitHook, MemberAdmission } from './registration/user-limit.hook';
import { BillingService } from './billing.service';
import { Plan, StorageLocation } from './entities/plan.entity';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';

describe('UserLimitHook & MemberAdmission (SPEC-102 T6 — Límite de usuarios del plan)', () => {
  let hook: UserLimitHook;
  let memberAdmission: MemberAdmission;
  let billingService: jest.Mocked<Partial<BillingService>>;

  const mockDemoPlan: Plan = {
    id: 'plan-demo-uuid',
    name: 'Demo',
    description: 'Espacio pequeño',
    priceCents: 0,
    storageLimitBytes: '5000000000',
    maxMembers: 5,
    validityDays: null,
    storageLocation: StorageLocation.CLOUD,
    active: true,
    createdAt: new Date(),
  };

  const mockTeamPlan: Plan = {
    id: 'plan-team-uuid',
    name: 'Team',
    description: 'Equipos pequeños',
    priceCents: 1999,
    storageLimitBytes: '100000000000',
    maxMembers: 10,
    validityDays: 30,
    storageLocation: StorageLocation.CLOUD,
    active: true,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    memberAdmission = new MemberAdmission();
    billingService = {
      getSubscription: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserLimitHook,
        { provide: MemberAdmission, useValue: memberAdmission },
        { provide: BillingService, useValue: billingService },
      ],
    }).compile();

    hook = module.get<UserLimitHook>(UserLimitHook);
  });

  describe('Registro e integración del hook en onModuleInit', () => {
    it('debe registrar la fuente de límite en MemberAdmission al inicializar el módulo', async () => {
      const registerSpy = jest.spyOn(memberAdmission, 'register');
      hook.onModuleInit();
      expect(registerSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cálculo del límite según la suscripción activa (Escenario 5 de SPEC-102)', () => {
    beforeEach(() => {
      hook.onModuleInit();
    });

    it('Escenario Demo: retorna 5 miembros máximos para una organización con plan Demo activo', async () => {
      const activeDemoSub: Subscription = {
        id: 'sub-demo-id',
        organizationId: 'org-demo-uuid',
        planId: mockDemoPlan.id,
        plan: mockDemoPlan,
        status: SubscriptionStatus.ACTIVE,
        simulated: true,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (billingService.getSubscription as jest.Mock).mockResolvedValue(activeDemoSub);

      const limit = await memberAdmission.userLimit('org-demo-uuid');

      expect(billingService.getSubscription).toHaveBeenCalledWith('org-demo-uuid');
      expect(limit).toBe(5);
    });

    it('Escenario Team: retorna 10 miembros máximos para una organización con plan Team activo', async () => {
      const activeTeamSub: Subscription = {
        id: 'sub-team-id',
        organizationId: 'org-team-uuid',
        planId: mockTeamPlan.id,
        plan: mockTeamPlan,
        status: SubscriptionStatus.ACTIVE,
        simulated: true,
        expiresAt: new Date(Date.now() + 86400000 * 20),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (billingService.getSubscription as jest.Mock).mockResolvedValue(activeTeamSub);

      const limit = await memberAdmission.userLimit('org-team-uuid');

      expect(billingService.getSubscription).toHaveBeenCalledWith('org-team-uuid');
      expect(limit).toBe(10);
    });

    it('Falla cerrada: retorna 0 si la organización no tiene suscripción activa (null)', async () => {
      (billingService.getSubscription as jest.Mock).mockResolvedValue(null);

      const limit = await memberAdmission.userLimit('org-sin-plan-uuid');

      expect(billingService.getSubscription).toHaveBeenCalledWith('org-sin-plan-uuid');
      expect(limit).toBe(0);
    });

    it('Falla cerrada: retorna 0 si la suscripción no tiene el objeto plan cargado', async () => {
      const subWithoutPlan: Partial<Subscription> = {
        id: 'sub-orphan-id',
        organizationId: 'org-orphan-uuid',
        planId: 'plan-id',
        status: SubscriptionStatus.ACTIVE,
      };
      (billingService.getSubscription as jest.Mock).mockResolvedValue(subWithoutPlan as Subscription);

      const limit = await memberAdmission.userLimit('org-orphan-uuid');

      expect(limit).toBe(0);
    });
  });

  describe('Comportamiento fail-closed del puerto MemberAdmission', () => {
    it('debe retornar 0 si no se ha registrado ninguna fuente (sin hook activo)', async () => {
      const uninitializedAdmission = new MemberAdmission();
      const limit = await uninitializedAdmission.userLimit('cualquier-org');
      expect(limit).toBe(0);
    });

    it('debe retornar 0 si la fuente registrada devuelve null o valor negativo', async () => {
      const admission = new MemberAdmission();
      admission.register(async () => null);
      expect(await admission.userLimit('org-1')).toBe(0);

      admission.register(async () => -5);
      expect(await admission.userLimit('org-2')).toBe(0);
    });
  });
});
