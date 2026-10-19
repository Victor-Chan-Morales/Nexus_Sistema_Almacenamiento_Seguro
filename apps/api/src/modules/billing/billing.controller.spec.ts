import { Test, TestingModule } from '@nestjs/testing';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { Plan, StorageLocation } from './entities/plan.entity';

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

  describe('Rutas retiradas por no ser consumidas por frontend', () => {
    it('no debe exponer GET /billing/subscription en BillingController', () => {
      expect((controller as any).getSubscription).toBeUndefined();
    });
  });
});
