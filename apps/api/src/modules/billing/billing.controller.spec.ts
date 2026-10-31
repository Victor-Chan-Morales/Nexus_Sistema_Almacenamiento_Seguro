import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { Plan, StorageLocation } from './entities/plan.entity';
import { RolesGuard } from '../iam/guards/roles.guard';
import { ROLES_KEY } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { AuthUser } from '../iam/interfaces/auth-user.interface';

describe('BillingController — Pruebas del controlador y contratos HTTP', () => {
  let controller: BillingController;
  let billingService: jest.Mocked<Partial<BillingService>>;

  const mockDemoPlan: Plan = {
    id: 'a0000000-0000-0000-0000-000000000001',
    name: 'Demo',
    description: 'Prueba el espacio de trabajo de Nexus',
    priceCents: 0,
    storageLimitBytes: '5000000000',
    maxMembers: 5,
    validityDays: null,
    storageLocation: StorageLocation.CLOUD,
    active: true,
    createdAt: new Date('2026-10-18T00:00:00.000Z'),
  };

  beforeEach(async () => {
    billingService = {
      listPlans: jest.fn().mockResolvedValue([mockDemoPlan]),
      listOperations: jest.fn().mockResolvedValue([
        {
          id: 'op-1-uuid',
          type: 'charge',
          planName: 'Team',
          amount: 19.99,
          simulated: true,
          occurredAt: '2026-10-29T18:30:00.000Z',
        },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        { provide: BillingService, useValue: billingService },
      ],
    }).compile();

    controller = module.get<BillingController>(BillingController);
  });

  describe('GET /api/plans', () => {
    it('debe devolver catálogo en formato { items: [...] } con precios y capacidades decimales aprobadas', async () => {
      const response = await controller.listPlans();

      expect(response).toHaveProperty('items');
      expect(response.items).toHaveLength(1);
      const item = response.items[0];
      expect(item.id).toBe(mockDemoPlan.id);
      expect(item.name).toBe('Demo');
      expect(item.priceMonthly).toBe(0);
      expect(item.storageLimitBytes).toBe(5000000000);
      expect(item.userLimit).toBe(5);
      expect(item.validityDays).toBeNull(); // Indefinido
    });
  });

  describe('GET /api/billing/operations (SPEC-301 — Escenarios 4, 5 y 6)', () => {
    it('Escenario 4 y 5: debe devolver { items } y pasar el organizationId del usuario autenticado (aislamiento multitenant)', async () => {
      const tenantAdminUser: AuthUser = {
        userId: 'user-admin-uuid',
        organizationId: 'org-tenant-uuid',
        role: Role.TENANT_ADMIN,
        email: 'admin@nexus.local',
        fullName: 'Admin Nexus',
        organizationName: 'Nexus Corp',
      };

      const response = await controller.listOperations({ user: tenantAdminUser });

      expect(billingService.listOperations).toHaveBeenCalledTimes(1);
      expect(billingService.listOperations).toHaveBeenCalledWith('org-tenant-uuid');
      expect(response).toEqual({
        items: [
          {
            id: 'op-1-uuid',
            type: 'charge',
            planName: 'Team',
            amount: 19.99,
            simulated: true,
            occurredAt: '2026-10-29T18:30:00.000Z',
          },
        ],
      });
    });

    it('Escenario 6: debe restringir la ruta a Role.TENANT_ADMIN y rechazar a colaborador con 403 FORBIDDEN_ROLE', () => {
      const reflector = new Reflector();
      const guard = new RolesGuard(reflector);

      const metadataRoles = reflector.get<Role[]>(
        ROLES_KEY,
        BillingController.prototype.listOperations,
      );
      expect(metadataRoles).toEqual([Role.TENANT_ADMIN]);

      const buildContext = (role: Role): ExecutionContext =>
        ({
          getHandler: () => BillingController.prototype.listOperations,
          getClass: () => BillingController,
          switchToHttp: () => ({
            getRequest: () => ({
              user: {
                userId: 'u-1',
                organizationId: 'org-1',
                role,
                email: 'user@nexus.local',
                fullName: 'Usuario',
                organizationName: 'Org',
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
    });
  });

  describe('Rutas retiradas por no ser consumidas por frontend', () => {
    it('no debe exponer GET /billing/subscription en BillingController', () => {
      expect((controller as unknown as Record<string, unknown>).getSubscription).toBeUndefined();
    });
  });
});
