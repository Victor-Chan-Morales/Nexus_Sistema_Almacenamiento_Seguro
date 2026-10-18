import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { Plan, StorageLocation } from './entities/plan.entity';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';
import { STORAGE_USAGE_PORT, StorageUsagePort } from './ports/storage-usage.port';

describe('BillingService — Pruebas unitarias de reglas de negocio', () => {
  let service: BillingService;
  let planRepo: jest.Mocked<Partial<Repository<Plan>>>;
  let subscriptionRepo: jest.Mocked<Partial<Repository<Subscription>>>;
  let dataSource: Partial<DataSource>;
  let storageUsagePort: jest.Mocked<StorageUsagePort>;

  const mockDemoPlan: Plan = {
    id: 'demo-plan-uuid',
    name: 'Plan Demo',
    description: 'Prueba el espacio de trabajo de Nexus',
    priceCents: 0,
    storageLimitBytes: '5368709120', // 5 GB
    maxMembers: 5,
    validityDays: null, // Vencimiento indefinido
    storageLocation: StorageLocation.CLOUD,
    active: true,
    createdAt: new Date(),
  };

  const mockTeamPlan: Plan = {
    id: 'team-plan-uuid',
    name: 'Plan Team',
    description: 'Para equipos pequeños',
    priceCents: 1999,
    storageLimitBytes: '107374182400', // 100 GB
    maxMembers: 10,
    validityDays: 30, // 30 días
    storageLocation: StorageLocation.CLOUD,
    active: true,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    planRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((entity: any) => entity as Plan) as any,
      save: jest.fn((entity: any) => Promise.resolve(entity as any)) as any,
    };

    subscriptionRepo = {
      findOne: jest.fn(),
      create: jest.fn((entity: any) => entity as Subscription) as any,
      save: jest.fn((entity: any) => Promise.resolve({ id: 'sub-new-uuid', createdAt: new Date(), ...entity } as any)) as any,
    };

    dataSource = {
      transaction: jest.fn(async (callback: any) => {
        const mockManager = {
          findOne: jest.fn(),
          create: jest.fn((_cls, entity) => entity),
          save: jest.fn((entity) => Promise.resolve({ id: 'sub-tx-uuid', createdAt: new Date(), ...entity })),
        };
        return callback(mockManager);
      }),
    };

    storageUsagePort = {
      getUsedStorageBytes: jest.fn().mockResolvedValue(BigInt(0)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: getRepositoryToken(Plan), useValue: planRepo },
        { provide: getRepositoryToken(Subscription), useValue: subscriptionRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: STORAGE_USAGE_PORT, useValue: storageUsagePort },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
  });

  describe('1. Catálogo, Plan Demo y Fail-Fast del Seed', () => {
    it('debe listar planes con Plan Demo gratuito y validityDays nulo', async () => {
      (planRepo.find as jest.Mock).mockResolvedValue([mockDemoPlan, mockTeamPlan]);

      const plans = await service.listPlans();
      expect(plans).toHaveLength(2);
      const demo = plans.find((p) => p.name === 'Plan Demo');
      expect(demo).toBeDefined();
      expect(demo?.priceCents).toBe(0);
      expect(demo?.validityDays).toBeNull();
      expect(demo?.storageLimitBytes).toBe('5368709120');
      expect(demo?.maxMembers).toBe(5);
    });

    it('seedDefaultPlans debe fallar inmediatamente (fail-fast) si la base de datos arroja error', async () => {
      (planRepo.findOneBy as jest.Mock).mockRejectedValue(new Error('Conexión perdida a PostgreSQL'));

      await expect(service.seedDefaultPlans()).rejects.toThrow('Conexión perdida a PostgreSQL');
    });
  });

  describe('2. Provisión inicial en registro (Hook atómico de IAM)', () => {
    it('debe provisionar Plan Demo con status active, simulated true y expiresAt null', async () => {
      const mockManager = {
        findOne: jest.fn().mockImplementation((_entity, options) => {
          if (options?.where?.name === 'Plan Demo') return Promise.resolve(mockDemoPlan);
          if (options?.where?.status === SubscriptionStatus.ACTIVE) return Promise.resolve(null);
          return Promise.resolve(null);
        }),
        create: jest.fn((_cls, entity) => entity),
        save: jest.fn((entity) => Promise.resolve({ id: 'initial-sub-id', createdAt: new Date(), ...entity })),
      };

      const result = await service.provisionInitialSubscription('org-123', mockManager as any);

      expect(result.organizationId).toBe('org-123');
      expect(result.status).toBe(SubscriptionStatus.ACTIVE);
      expect(result.simulated).toBe(true);
      expect(result.expiresAt).toBeNull(); // Demo es permanente
      expect(mockManager.save).toHaveBeenCalled();
    });

    it('debe ser idempotente si la organización ya tiene Demo activo', async () => {
      const existingSub: Subscription = {
        id: 'existing-sub-id',
        organizationId: 'org-123',
        planId: mockDemoPlan.id,
        plan: mockDemoPlan,
        status: SubscriptionStatus.ACTIVE,
        simulated: true,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockManager = {
        findOne: jest.fn().mockImplementation((_entity, options) => {
          if (options?.where?.name === 'Plan Demo') return Promise.resolve(mockDemoPlan);
          if (options?.where?.status === SubscriptionStatus.ACTIVE) return Promise.resolve(existingSub);
          return Promise.resolve(null);
        }),
      };

      const result = await service.provisionInitialSubscription('org-123', mockManager as any);
      expect(result.id).toBe('existing-sub-id');
    });
  });

  describe('3. Inversión de Dependencias (StorageUsagePort), Idempotencia y Downgrade', () => {
    it('debe retornar la suscripción existente sin recrear si se activa el mismo plan (idempotencia)', async () => {
      (planRepo.findOneBy as jest.Mock).mockResolvedValue(mockTeamPlan);

      const existingActive: Subscription = {
        id: 'current-team-sub',
        organizationId: 'org-123',
        planId: mockTeamPlan.id,
        plan: mockTeamPlan,
        status: SubscriptionStatus.ACTIVE,
        simulated: true,
        expiresAt: new Date(Date.now() + 86400000 * 25),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(service, 'getActiveSubscription').mockResolvedValue(existingActive);

      const result = await service.subscribe('org-123', mockTeamPlan.id);
      expect(result.id).toBe('current-team-sub');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('debe consultar StorageUsagePort y rechazar el downgrade si el uso supera la cuota del nuevo plan', async () => {
      (planRepo.findOneBy as jest.Mock).mockResolvedValue(mockDemoPlan); // 5 GB = 5368709120 bytes

      // StorageUsagePort reporta 6 GB ocupados
      storageUsagePort.getUsedStorageBytes.mockResolvedValue(BigInt(6442450944));

      const existingActive: Subscription = {
        id: 'active-team-sub',
        organizationId: 'org-123',
        planId: mockTeamPlan.id,
        plan: mockTeamPlan,
        status: SubscriptionStatus.ACTIVE,
        simulated: true,
        expiresAt: new Date(Date.now() + 86400000 * 20),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      jest.spyOn(service, 'getActiveSubscription').mockResolvedValue(existingActive);

      await expect(service.subscribe('org-123', mockDemoPlan.id)).rejects.toThrow(ConflictException);
      expect(storageUsagePort.getUsedStorageBytes).toHaveBeenCalledWith('org-123');
    });

    it('debe permitir cambio de plan transaccional si el uso reportado por el puerto no supera la cuota', async () => {
      (planRepo.findOneBy as jest.Mock).mockResolvedValue(mockTeamPlan);

      // StorageUsagePort reporta 2 GB ocupados (menor a los 100 GB de Team)
      storageUsagePort.getUsedStorageBytes.mockResolvedValue(BigInt(2147483648));
      jest.spyOn(service, 'getActiveSubscription').mockResolvedValue(null);

      const result = await service.subscribe('org-123', mockTeamPlan.id);
      expect(result).toBeDefined();
      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });

  describe('4. Consulta de cuota, expiración y fallback de estado', () => {
    it('debe retornar el límite del plan activo para FilesModule', async () => {
      const activeDemo: Subscription = {
        id: 'sub-active',
        organizationId: 'org-123',
        planId: mockDemoPlan.id,
        plan: mockDemoPlan,
        status: SubscriptionStatus.ACTIVE,
        simulated: true,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      jest.spyOn(service, 'getActiveSubscription').mockResolvedValue(activeDemo);

      const limit = await service.getStorageLimitBytes('org-123');
      expect(limit).toBe(BigInt(5368709120));
    });

    it('debe retornar 0 bytes si la suscripción venció o no existe (Fallback seguro)', async () => {
      jest.spyOn(service, 'getActiveSubscription').mockResolvedValue(null);

      const limit = await service.getStorageLimitBytes('org-123');
      expect(limit).toBe(BigInt(0));

      const summary = await service.getSubscriptionSummary('org-123');
      expect(summary.status).toBe('inactive');
      expect(summary.storageLimitBytes).toBe(0);
      expect(summary.plan).toBeNull();
    });
  });
});
