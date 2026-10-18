import { Test, TestingModule } from '@nestjs/testing';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { Plan, StorageLocation } from './entities/plan.entity';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';

describe('BillingController — Pruebas del controlador y contratos HTTP', () => {
  let controller: BillingController;
  let billingService: jest.Mocked<Partial<BillingService>>;

  const mockDemoPlan: Plan = {
    id: 'a0000000-0000-0000-0000-000000000001',
    name: 'Plan Demo',
    description: 'Prueba el espacio de trabajo de Nexus',
    priceCents: 0,
    storageLimitBytes: '5368709120',
    maxMembers: 5,
    validityDays: null,
    storageLocation: StorageLocation.CLOUD,
    active: true,
    createdAt: new Date('2026-10-18T00:00:00.000Z'),
  };

  const mockSub: Subscription = {
    id: 'b0000000-0000-0000-0000-000000000002',
    organizationId: 'org-tenant-uuid-1234',
    planId: mockDemoPlan.id,
    plan: mockDemoPlan,
    status: SubscriptionStatus.ACTIVE,
    simulated: true,
    expiresAt: null,
    createdAt: new Date('2026-10-18T10:00:00.000Z'),
    updatedAt: new Date('2026-10-18T10:00:00.000Z'),
  };

  beforeEach(async () => {
    billingService = {
      listPlans: jest.fn().mockResolvedValue([mockDemoPlan]),
      subscribe: jest.fn().mockResolvedValue(mockSub),
      getSubscription: jest.fn().mockResolvedValue(mockSub),
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
    it('debe devolver catálogo en formato { items: [...] } con precios y vigencias aprobadas', async () => {
      const response = await controller.listPlans();

      expect(response).toHaveProperty('items');
      expect(response.items).toHaveLength(1);
      const item = response.items[0];
      expect(item.id).toBe(mockDemoPlan.id);
      expect(item.name).toBe('Plan Demo');
      expect(item.priceMonthly).toBe(0);
      expect(item.storageLimitBytes).toBe(5368709120);
      expect(item.userLimit).toBe(5);
      expect(item.validityDays).toBeNull(); // Indefinido
    });
  });

  describe('POST /api/subscriptions/activate', () => {
    it('debe extraer el tenant exclusivamente de req.user.organizationId y responder con simulated: true', async () => {
      const req = {
        user: {
          id: 'user-uuid-9999',
          organizationId: 'org-tenant-uuid-1234',
        },
      };
      const dto = { planId: mockDemoPlan.id };

      const response = await controller.activate(req, dto);

      expect(billingService.subscribe).toHaveBeenCalledWith('org-tenant-uuid-1234', mockDemoPlan.id);
      expect(response.subscriptionId).toBe(mockSub.id);
      expect(response.status).toBe('active');
      expect(response.simulated).toBe(true);
      expect(response.startDate).toBe('2026-10-18T10:00:00.000Z');
      expect(response.endDate).toBeNull();
    });
  });

  describe('GET /api/billing/subscription', () => {
    it('debe retornar el detalle de la suscripción para el tenant autenticado', async () => {
      const req = {
        user: { organizationId: 'org-tenant-uuid-1234' },
      };

      const response = await controller.getSubscription(req);

      expect(billingService.getSubscription).toHaveBeenCalledWith('org-tenant-uuid-1234');
      expect(response.id).toBe(mockSub.id);
      expect(response.organizationId).toBe('org-tenant-uuid-1234');
      expect(response.status).toBe('active');
      expect(response.simulated).toBe(true);
      expect(response.plan.name).toBe('Plan Demo');
    });
  });
});
