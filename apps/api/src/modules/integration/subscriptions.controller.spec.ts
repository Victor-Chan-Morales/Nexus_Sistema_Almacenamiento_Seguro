import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionCoordinator } from './subscription.coordinator';
import { BillingService } from '../billing/billing.service';
import { Subscription, SubscriptionStatus } from '../billing/entities/subscription.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { RolesGuard } from '../iam/guards/roles.guard';
import { ROLES_KEY } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { AuthUser } from '../iam/interfaces/auth-user.interface';

describe('SubscriptionsController — Pruebas de contratos HTTP y RBAC (SPEC-302)', () => {
  let controller: SubscriptionsController;
  let coordinator: jest.Mocked<Partial<SubscriptionCoordinator>>;
  let billingService: jest.Mocked<Partial<BillingService>>;
  let audit: { logEvent: jest.Mock };

  const mockSubscription: Subscription = {
    id: 'sub-team-uuid',
    organizationId: 'org-tenant-uuid',
    planId: 'plan-team-uuid',
    status: SubscriptionStatus.ACTIVE,
    simulated: true,
    startDate: new Date('2026-10-10T00:00:00.000Z'),
    expiresAt: new Date('2026-12-10T00:00:00.000Z'),
    createdAt: new Date('2026-10-10T00:00:00.000Z'),
  } as Subscription;

  const tenantAdminUser: AuthUser = {
    userId: 'user-admin-uuid',
    organizationId: 'org-tenant-uuid',
    role: Role.TENANT_ADMIN,
    email: 'admin@nexus.local',
    fullName: 'Admin Nexus',
    organizationName: 'Nexus Corp',
  };

  beforeEach(async () => {
    coordinator = {
      activateSubscription: jest.fn().mockResolvedValue(mockSubscription),
    };

    billingService = {
      renewSubscription: jest.fn().mockResolvedValue(mockSubscription),
    };

    audit = { logEvent: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionsController],
      providers: [
        { provide: SubscriptionCoordinator, useValue: coordinator },
        { provide: BillingService, useValue: billingService },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    controller = module.get<SubscriptionsController>(SubscriptionsController);
  });

  describe('POST /api/subscriptions/activate y POST /api/subscriptions/renew (Escenarios 1 y 6)', () => {
    it('renew debe delegar en BillingService con el organizationId del token y devolver el mismo formato que activate', async () => {
      const response = await controller.renew({ user: tenantAdminUser });

      expect(billingService.renewSubscription).toHaveBeenCalledTimes(1);
      expect(billingService.renewSubscription).toHaveBeenCalledWith('org-tenant-uuid');
      expect(response).toEqual({
        subscriptionId: 'sub-team-uuid',
        status: 'active',
        simulated: true,
        startDate: '2026-10-10T00:00:00.000Z',
        endDate: '2026-12-10T00:00:00.000Z',
      });
    });

    it('activate debe delegar en SubscriptionCoordinator con el organizationId del token y compartir el mapeo de respuesta', async () => {
      const response = await controller.activate(
        { user: tenantAdminUser },
        { planId: 'plan-team-uuid' },
      );

      expect(coordinator.activateSubscription).toHaveBeenCalledWith(
        'org-tenant-uuid',
        'plan-team-uuid',
      );
      expect(response).toEqual({
        subscriptionId: 'sub-team-uuid',
        status: 'active',
        simulated: true,
        startDate: '2026-10-10T00:00:00.000Z',
        endDate: '2026-12-10T00:00:00.000Z',
      });
    });
  });

  describe('SPEC-405: PLAN_ACTIVATED y PLAN_RENEWED', () => {
    it('Escenario 1: activate registra PLAN_ACTIVATED con la organización del token y la suscripción resultante', async () => {
      await controller.activate({ user: tenantAdminUser }, { planId: 'plan-team-uuid' });
      expect(audit.logEvent).toHaveBeenCalledTimes(1);
      expect(audit.logEvent).toHaveBeenCalledWith({
        organizationId: 'org-tenant-uuid',
        actorId: 'user-admin-uuid',
        action: AuditAction.PLAN_ACTIVATED,
        resourceType: AuditResource.SUBSCRIPTION,
        resourceId: 'sub-team-uuid',
      });
    });

    it('Escenario 1: renew registra PLAN_RENEWED con la suscripción renovada', async () => {
      await controller.renew({ user: tenantAdminUser });
      expect(audit.logEvent).toHaveBeenCalledTimes(1);
      expect(audit.logEvent).toHaveBeenCalledWith({
        organizationId: 'org-tenant-uuid',
        actorId: 'user-admin-uuid',
        action: AuditAction.PLAN_RENEWED,
        resourceType: AuditResource.SUBSCRIPTION,
        resourceId: 'sub-team-uuid',
      });
    });

    it('Escenario 1: la reactivación idempotente también registra PLAN_ACTIVATED', async () => {
      // El coordinador devuelve la suscripción vigente sin crear otra: el evento se registra igualmente
      jest.mocked(coordinator.activateSubscription).mockResolvedValueOnce(mockSubscription);
      await controller.activate({ user: tenantAdminUser }, { planId: 'plan-team-uuid' });
      expect(audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.PLAN_ACTIVATED }));
    });

    it('Escenario 2: si la activación o la renovación fallan no se registra evento', async () => {
      jest.mocked(coordinator.activateSubscription).mockRejectedValueOnce(new Error('NO_ACTIVE_SUBSCRIPTION'));
      await expect(controller.activate({ user: tenantAdminUser }, { planId: 'plan-team-uuid' })).rejects.toThrow();

      jest.mocked(billingService.renewSubscription).mockRejectedValueOnce(new Error('PLAN_NOT_RENEWABLE'));
      await expect(controller.renew({ user: tenantAdminUser })).rejects.toThrow();

      expect(audit.logEvent).not.toHaveBeenCalled();
    });

    it('Escenario 3: si logEvent falla, la respuesta es la misma que sin auditoría', async () => {
      audit.logEvent.mockRejectedValueOnce(new Error('Audit DB down'));
      const response = await controller.renew({ user: tenantAdminUser });
      expect(response).toEqual({
        subscriptionId: 'sub-team-uuid',
        status: 'active',
        simulated: true,
        startDate: '2026-10-10T00:00:00.000Z',
        endDate: '2026-12-10T00:00:00.000Z',
      });
    });

    it('Escenario 4: el evento se registra después de que la operación resuelva', async () => {
      const order: string[] = [];
      jest.mocked(coordinator.activateSubscription).mockImplementationOnce(async () => (order.push('operation'), mockSubscription));
      audit.logEvent.mockImplementationOnce(async () => void order.push('audit'));
      await controller.activate({ user: tenantAdminUser }, { planId: 'plan-team-uuid' });
      expect(order).toEqual(['operation', 'audit']);
    });
  });

  describe('Restricción de rol tenant_admin (Escenario 4)', () => {
    it.each([
      ['activate', SubscriptionsController.prototype.activate],
      ['renew', SubscriptionsController.prototype.renew],
    ])(
      'debe exigir Role.TENANT_ADMIN en %s y rechazar a colaborador con 403 FORBIDDEN_ROLE',
      (_name, handler) => {
        const reflector = new Reflector();
        const guard = new RolesGuard(reflector);

        expect(reflector.get<Role[]>(ROLES_KEY, handler)).toEqual([Role.TENANT_ADMIN]);

        const buildContext = (role: Role): ExecutionContext =>
          ({
            getHandler: () => handler,
            getClass: () => SubscriptionsController,
            switchToHttp: () => ({
              getRequest: () => ({
                user: {
                  ...tenantAdminUser,
                  role,
                } satisfies AuthUser,
              }),
            }),
          }) as unknown as ExecutionContext;

        expect(guard.canActivate(buildContext(Role.TENANT_ADMIN))).toBe(true);

        let thrown: unknown;
        try {
          guard.canActivate(buildContext(Role.COLABORADOR));
        } catch (err) {
          thrown = err;
        }

        expect(thrown).toBeInstanceOf(ForbiddenException);
        expect((thrown as ForbiddenException).getStatus()).toBe(403);
        expect((thrown as ForbiddenException).getResponse()).toMatchObject({
          code: 'FORBIDDEN_ROLE',
        });
      },
    );
  });
});
