import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionCoordinator } from './subscription.coordinator';
import { BillingService } from '../billing/billing.service';
import { Subscription, SubscriptionStatus } from '../billing/entities/subscription.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource, AuditResult } from '../audit/audit.types';
import { PaymentDeclinedException } from '../billing/simulated-payment';
import { PaymentDto } from '../billing/billing.dto';
import { RolesGuard } from '../iam/guards/roles.guard';
import { ROLES_KEY } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { AccountNotices } from '../iam/services/account-notices.service';

describe('SubscriptionsController — Pruebas de contratos HTTP y RBAC (SPEC-302)', () => {
  let controller: SubscriptionsController;
  let coordinator: jest.Mocked<Partial<SubscriptionCoordinator>>;
  let billingService: jest.Mocked<Partial<BillingService>>;
  let audit: { logEvent: jest.Mock };
  let planChanged: jest.Mock;

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
    isSuperAdmin: false,
  };

  beforeEach(async () => {
    coordinator = {
      activateSubscription: jest.fn().mockResolvedValue(mockSubscription),
    };

    billingService = {
      renewSubscription: jest.fn().mockResolvedValue(mockSubscription),
    };

    audit = { logEvent: jest.fn().mockResolvedValue(undefined) };
    planChanged = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionsController],
      providers: [
        { provide: SubscriptionCoordinator, useValue: coordinator },
        { provide: BillingService, useValue: billingService },
        { provide: AuditService, useValue: audit },
        { provide: AccountNotices, useValue: { planChanged } },
      ],
    }).compile();

    controller = module.get<SubscriptionsController>(SubscriptionsController);
  });

  describe('POST /api/subscriptions/activate y POST /api/subscriptions/renew (Escenarios 1 y 6)', () => {
    it('renew debe delegar en BillingService con el organizationId del token y devolver el mismo formato que activate', async () => {
      const response = await controller.renew({ user: tenantAdminUser });

      expect(billingService.renewSubscription).toHaveBeenCalledTimes(1);
      expect(billingService.renewSubscription).toHaveBeenCalledWith('org-tenant-uuid', undefined);
      expect(planChanged).toHaveBeenCalledWith('org-tenant-uuid');
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
        undefined,
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

  describe('SPEC-305: pago simulado y auditoría del rechazo', () => {
    const approvedCard: PaymentDto = {
      cardNumber: '4242424242424242',
      holderName: 'Ana Pérez',
      expiry: '12/99',
      cvv: '987',
    };
    const declinedCard: PaymentDto = { ...approvedCard, cardNumber: '4000000000000002' };

    const expectNoCardData = (value: unknown): void => {
      const serialized = JSON.stringify(value) ?? '';
      expect(serialized).not.toContain(approvedCard.cardNumber);
      expect(serialized).not.toContain(declinedCard.cardNumber);
      expect(serialized).not.toMatch(new RegExp(`(^|\\D)${approvedCard.cvv}(\\D|$)`));
      expect(serialized).not.toMatch(/cvv|cardNumber|holderName/i);
    };

    const declinedEvent = {
      organizationId: 'org-tenant-uuid',
      actorId: 'user-admin-uuid',
      action: AuditAction.PAYMENT_DECLINED,
      resourceType: AuditResource.SUBSCRIPTION,
      result: AuditResult.FAILURE,
    };

    it('activate pasa el payment al coordinador', async () => {
      await controller.activate({ user: tenantAdminUser }, { planId: 'plan-team-uuid', payment: approvedCard });
      expect(coordinator.activateSubscription).toHaveBeenCalledWith('org-tenant-uuid', 'plan-team-uuid', approvedCard);
    });

    it('renew pasa el payment a BillingService', async () => {
      await controller.renew({ user: tenantAdminUser }, { payment: approvedCard });
      expect(billingService.renewSubscription).toHaveBeenCalledWith('org-tenant-uuid', approvedCard);
    });

    it('Escenario 2: un rechazo en activate registra PAYMENT_DECLINED con resultado failure y responde 402', async () => {
      const order: string[] = [];
      jest.mocked(coordinator.activateSubscription).mockRejectedValueOnce(new PaymentDeclinedException());
      audit.logEvent.mockImplementationOnce(async () => void order.push('audit'));

      const error = await controller
        .activate({ user: tenantAdminUser }, { planId: 'plan-team-uuid', payment: declinedCard })
        .catch((err: unknown) => (order.push('thrown'), err));

      expect(error).toBeInstanceOf(PaymentDeclinedException);
      expect((error as PaymentDeclinedException).getStatus()).toBe(402);
      expect(audit.logEvent).toHaveBeenCalledTimes(1);
      expect(audit.logEvent).toHaveBeenCalledWith(declinedEvent);
      expect(order).toEqual(['audit', 'thrown']);
      expectNoCardData(audit.logEvent.mock.calls);
      expectNoCardData((error as PaymentDeclinedException).getResponse());
    });

    it('Escenario 4: un rechazo en renew registra PAYMENT_DECLINED con resultado failure y responde 402', async () => {
      jest.mocked(billingService.renewSubscription).mockRejectedValueOnce(new PaymentDeclinedException());

      const error = await controller
        .renew({ user: tenantAdminUser }, { payment: declinedCard })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(PaymentDeclinedException);
      expect((error as PaymentDeclinedException).getStatus()).toBe(402);
      expect(audit.logEvent).toHaveBeenCalledTimes(1);
      expect(audit.logEvent).toHaveBeenCalledWith(declinedEvent);
      expectNoCardData(audit.logEvent.mock.calls);
    });

    it('Escenario 3: TEST_CARD_REQUIRED (422) no se audita', async () => {
      jest.mocked(coordinator.activateSubscription).mockRejectedValueOnce(
        new UnprocessableEntityException({ code: 'TEST_CARD_REQUIRED', message: 'Solo se aceptan tarjetas de prueba.' }),
      );

      await expect(
        controller.activate({ user: tenantAdminUser }, { planId: 'plan-team-uuid', payment: approvedCard }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(audit.logEvent).not.toHaveBeenCalled();
    });

    it('Escenarios 1 y 4: un pago aprobado registra solo PLAN_ACTIVATED o PLAN_RENEWED, sin datos de la tarjeta', async () => {
      const activated = await controller.activate(
        { user: tenantAdminUser },
        { planId: 'plan-team-uuid', payment: approvedCard },
      );
      const renewed = await controller.renew({ user: tenantAdminUser }, { payment: approvedCard });

      const actions = audit.logEvent.mock.calls.map(([event]: [{ action: AuditAction }]) => event.action);
      expect(actions).toEqual([AuditAction.PLAN_ACTIVATED, AuditAction.PLAN_RENEWED]);
      expectNoCardData(audit.logEvent.mock.calls);
      expectNoCardData([activated, renewed]);
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
