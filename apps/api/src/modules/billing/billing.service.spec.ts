import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { Plan, StorageLocation } from './entities/plan.entity';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';
import { BillingOperation, BillingOperationType } from './entities/billing-operation.entity';

describe('BillingService — Pruebas unitarias de reglas de negocio', () => {
  let service: BillingService;
  let planRepo: jest.Mocked<Partial<Repository<Plan>>>;
  let subscriptionRepo: jest.Mocked<Partial<Repository<Subscription>>>;
  let billingOperationRepo: jest.Mocked<Partial<Repository<BillingOperation>>>;
  let dataSource: Partial<DataSource>;

  const mockDemoPlan: Plan = {
    id: 'demo-plan-uuid',
    name: 'Demo',
    description: 'Prueba el espacio de trabajo de Nexus',
    priceCents: 0,
    storageLimitBytes: '5000000000', // 5 GB decimales
    maxMembers: 5,
    validityDays: null, // Vencimiento indefinido
    storageLocation: StorageLocation.CLOUD,
    active: true,
    createdAt: new Date(),
  };

  const mockTeamPlan: Plan = {
    id: 'team-plan-uuid',
    name: 'Team',
    description: 'Para equipos pequeños',
    priceCents: 1999,
    storageLimitBytes: '100000000000', // 100 GB decimales
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

    billingOperationRepo = {
      createQueryBuilder: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: getRepositoryToken(Plan), useValue: planRepo },
        { provide: getRepositoryToken(Subscription), useValue: subscriptionRepo },
        { provide: getRepositoryToken(BillingOperation), useValue: billingOperationRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
  });

  describe('1. Catálogo, Plan Demo y Fail-Fast del Seed', () => {
    it('debe listar planes con Plan Demo gratuito, decimal (5000000000 bytes) y validityDays nulo', async () => {
      (planRepo.find as jest.Mock).mockResolvedValue([mockDemoPlan, mockTeamPlan]);

      const plans = await service.listPlans();
      expect(plans).toHaveLength(2);
      const demo = plans.find((p) => p.name === 'Demo');
      expect(demo).toBeDefined();
      expect(demo?.priceCents).toBe(0);
      expect(demo?.validityDays).toBeNull();
      expect(demo?.storageLimitBytes).toBe('5000000000');
      expect(demo?.maxMembers).toBe(5);
    });

    it('seedDefaultPlans debe fallar inmediatamente (fail-fast) si la base de datos arroja error', async () => {
      (planRepo.findOneBy as jest.Mock).mockRejectedValue(new Error('Conexión perdida a PostgreSQL'));

      await expect(service.seedDefaultPlans()).rejects.toThrow('Conexión perdida a PostgreSQL');
    });
  });

  describe('2. Provisión inicial en registro (Hook atómico de IAM)', () => {
    it('debe provisionar Plan Demo con status active, simulated true, expiresAt null y operación charge de amount 0 (Escenario 1)', async () => {
      const mockManager = {
        findOne: jest.fn().mockImplementation((_entity, options) => {
          if (options?.where?.name === 'Demo') return Promise.resolve(mockDemoPlan);
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
      expect(mockManager.create).toHaveBeenCalledWith(
        BillingOperation,
        expect.objectContaining({
          subscriptionId: 'initial-sub-id',
          type: BillingOperationType.CHARGE,
          amount: 0,
        }),
      );
      expect(mockManager.save).toHaveBeenCalledTimes(2);
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
          if (options?.where?.name === 'Demo') return Promise.resolve(mockDemoPlan);
          if (options?.where?.status === SubscriptionStatus.ACTIVE) return Promise.resolve(existingSub);
          return Promise.resolve(null);
        }),
      };

      const result = await service.provisionInitialSubscription('org-123', mockManager as any);
      expect(result.id).toBe('existing-sub-id');
    });

    it('Escenario 7 (Atomicidad): si falla la escritura de la operación, la suscripción no queda persistida', async () => {
      const persisted: unknown[] = [];
      (dataSource.transaction as jest.Mock).mockImplementation(async (callback: (m: unknown) => Promise<unknown>) => {
        // Simula COMMIT/ROLLBACK: lo escrito solo se persiste si el callback de la transacción resuelve
        const staged: unknown[] = [];
        const mockManager = {
          findOne: jest.fn().mockImplementation((_entity, options) => {
            if (options?.where?.name === 'Demo') return Promise.resolve(mockDemoPlan);
            return Promise.resolve(null);
          }),
          create: jest.fn((_cls, entity) => entity),
          save: jest.fn(async (entity: { subscriptionId?: string }) => {
            if (entity.subscriptionId) throw new Error('Fallo en billing_operation');
            const saved = { id: 'initial-sub-id', createdAt: new Date(), ...entity };
            staged.push(saved);
            return saved;
          }),
        };
        const result = await callback(mockManager);
        persisted.push(...staged);
        return result;
      });

      await expect(service.provisionInitialSubscription('org-123')).rejects.toThrow('Fallo en billing_operation');
      expect(persisted).toHaveLength(0);
    });
  });

  describe('3. Persistencia de Suscripción, Idempotencia y Manejo de Concurrencia', () => {
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

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(existingActive),
        save: jest.fn(),
      };

      (dataSource.transaction as jest.Mock).mockImplementation((cb: any) => cb(mockManager));

      const result = await service.subscribe('org-123', mockTeamPlan.id);
      expect(result.id).toBe('current-team-sub');
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('debe capturar colisión de índice único parcial (23505) y lanzar ConflictException controlado', async () => {
      (planRepo.findOneBy as jest.Mock).mockResolvedValue(mockTeamPlan);

      const collisionError = new Error('duplicate key value violates unique constraint "uq_subscription_one_active_per_organization"');
      (collisionError as any).code = '23505';

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((_cls, entity) => entity),
        save: jest.fn().mockRejectedValue(collisionError),
      };

      (dataSource.transaction as jest.Mock).mockImplementation((cb: any) => cb(mockManager));

      await expect(service.subscribe('org-123', mockTeamPlan.id)).rejects.toThrow(ConflictException);
    });
  });

  describe('4. Consulta de cuota, vigencia y fallback de estado', () => {
    it('debe retornar el límite del plan activo en bytes decimales', async () => {
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
      expect(limit).toBe(BigInt(5000000000));
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

    it('getSubscription debe retornar únicamente la suscripción vigente y no historial cancelado', async () => {
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

      const result = await service.getSubscription('org-123');
      expect(result).toBe(activeDemo);
    });
  });

  describe('5. Historial de operaciones simuladas (listOperations — Escenarios 4 y 5)', () => {
    it('debe listar las operaciones de la organización ordenadas por simulatedAt DESC (máx. 100) y convertir amount a number', async () => {
      const qb = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'op-team-uuid',
            subscriptionId: 'sub-team',
            type: BillingOperationType.CHARGE,
            amount: '19.99' as unknown as number,
            simulatedAt: new Date('2026-10-29T18:00:00.000Z'),
            subscription: { id: 'sub-team', organizationId: 'org-123', plan: mockTeamPlan },
          },
        ]),
      };
      (billingOperationRepo.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const items = await service.listOperations('org-123');

      expect(qb.where).toHaveBeenCalledWith('sub.organizationId = :organizationId', {
        organizationId: 'org-123',
      });
      expect(qb.orderBy).toHaveBeenCalledWith('op.simulatedAt', 'DESC');
      expect(qb.take).toHaveBeenCalledWith(100);
      expect(items).toEqual([
        {
          id: 'op-team-uuid',
          type: 'charge',
          planName: 'Team',
          amount: 19.99,
          simulated: true,
          occurredAt: '2026-10-29T18:00:00.000Z',
        },
      ]);
    });
  });

  describe('6. Renovación de suscripción (renewSubscription — SPEC-302 Escenarios 1, 2, 3, 5 y 6)', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('Escenario 1, 5 y 6: debe extender expiresAt en validityDays desde max(hoy, fin actual), conservar el mismo subscriptionId y registrar operación renewal con bloqueo pesimista', async () => {
      // Fija "hoy" para que el resultado no dependa de la fecha real del sistema
      jest.useFakeTimers({ now: new Date('2026-10-29T12:00:00.000Z') });

      const activeTeam: Subscription = {
        id: 'sub-team-active',
        organizationId: 'org-123',
        planId: mockTeamPlan.id,
        plan: mockTeamPlan,
        status: SubscriptionStatus.ACTIVE,
        simulated: true,
        startDate: new Date('2026-10-11T00:00:00.000Z'),
        expiresAt: new Date('2026-11-10T00:00:00.000Z'),
        createdAt: new Date('2026-10-11T00:00:00.000Z'),
      };

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(activeTeam),
        create: jest.fn((_cls: unknown, entity: unknown) => entity),
        save: jest.fn((entity: unknown) => Promise.resolve(entity)),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(mockManager));

      const renewed = await service.renewSubscription('org-123');

      expect(mockManager.findOne).toHaveBeenCalledWith(Subscription, {
        where: { organizationId: 'org-123', status: SubscriptionStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });
      expect(renewed.id).toBe('sub-team-active');
      expect(renewed.expiresAt?.toISOString()).toBe('2026-12-10T00:00:00.000Z');
      expect(mockManager.create).toHaveBeenCalledWith(
        BillingOperation,
        expect.objectContaining({
          subscriptionId: 'sub-team-active',
          type: BillingOperationType.RENEWAL,
          amount: 19.99,
        }),
      );
      expect(mockManager.save).toHaveBeenCalledTimes(2);
    });

    it('Escenario 2: debe rechazar con 422 PLAN_NOT_RENEWABLE si el plan no tiene vigencia (Demo)', async () => {
      const activeDemo: Subscription = {
        id: 'sub-demo-active',
        organizationId: 'org-123',
        planId: mockDemoPlan.id,
        plan: mockDemoPlan,
        status: SubscriptionStatus.ACTIVE,
        simulated: true,
        expiresAt: null,
        createdAt: new Date(),
      };

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(activeDemo),
        create: jest.fn(),
        save: jest.fn(),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(mockManager));

      const error = await service.renewSubscription('org-123').catch((err: unknown) => err);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getStatus()).toBe(422);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        code: 'PLAN_NOT_RENEWABLE',
      });
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('Escenario 3: debe rechazar con 422 NO_ACTIVE_SUBSCRIPTION si no existe suscripción activa o si ya venció', async () => {
      const mockManagerNoSub = {
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn(),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(mockManagerNoSub));

      const errNoSub = await service.renewSubscription('org-123').catch((err: unknown) => err);
      expect(errNoSub).toBeInstanceOf(UnprocessableEntityException);
      expect((errNoSub as UnprocessableEntityException).getResponse()).toMatchObject({
        code: 'NO_ACTIVE_SUBSCRIPTION',
      });

      const expiredTeam: Subscription = {
        id: 'sub-team-expired',
        organizationId: 'org-123',
        planId: mockTeamPlan.id,
        plan: mockTeamPlan,
        status: SubscriptionStatus.ACTIVE,
        simulated: true,
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        createdAt: new Date('2019-12-01T00:00:00.000Z'),
      };
      const mockManagerExpired = {
        findOne: jest.fn().mockResolvedValue(expiredTeam),
        save: jest.fn(),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(mockManagerExpired));

      const errExpired = await service.renewSubscription('org-123').catch((err: unknown) => err);
      expect(errExpired).toBeInstanceOf(UnprocessableEntityException);
      expect((errExpired as UnprocessableEntityException).getResponse()).toMatchObject({
        code: 'NO_ACTIVE_SUBSCRIPTION',
      });
      expect(mockManagerExpired.save).not.toHaveBeenCalled();
    });
  });
});
