import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { BillingService, PlanChanges } from './billing.service';
import { Plan, StorageLocation } from './entities/plan.entity';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';
import { BillingOperation, BillingOperationType } from './entities/billing-operation.entity';
import { PaymentDeclinedException, PaymentInput } from './simulated-payment';

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

  // Tarjetas de prueba de SPEC-305; el vencimiento queda en el futuro respecto de los relojes fijados
  const approvedCard: PaymentInput = {
    cardNumber: '4242 4242 4242 4242',
    holderName: 'Ana Pérez',
    expiry: '12/30',
    cvv: '123',
  };
  const declinedCard: PaymentInput = { ...approvedCard, cardNumber: '4000 0000 0000 0002' };

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

      const result = await service.persistSubscription('org-123', mockTeamPlan);
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

      await expect(service.persistSubscription('org-123', mockTeamPlan)).rejects.toThrow(ConflictException);
    });

    it('SPEC-305 Escenario 1: la operación charge guarda el cardLast4 recibido', async () => {
      const mockManager = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((_cls: unknown, entity: unknown) => entity),
        save: jest.fn((entity: unknown) => Promise.resolve({ id: 'sub-new', ...(entity as object) })),
      };

      await service.persistSubscription('org-123', mockTeamPlan, mockManager as never, '4242');

      expect(mockManager.create).toHaveBeenCalledWith(
        BillingOperation,
        expect.objectContaining({ type: BillingOperationType.CHARGE, amount: 19.99, cardLast4: '4242' }),
      );
    });

    it('SPEC-305 Escenario 5: sin cardLast4 la operación guarda null', async () => {
      const mockManager = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((_cls: unknown, entity: unknown) => entity),
        save: jest.fn((entity: unknown) => Promise.resolve({ id: 'sub-new', ...(entity as object) })),
      };

      await service.persistSubscription('org-123', mockDemoPlan, mockManager as never);

      expect(mockManager.create).toHaveBeenCalledWith(
        BillingOperation,
        expect.objectContaining({ type: BillingOperationType.CHARGE, amount: 0, cardLast4: null }),
      );
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
            cardLast4: '4242',
          },
          {
            id: 'op-demo-uuid',
            subscriptionId: 'sub-demo',
            type: BillingOperationType.CHARGE,
            amount: '0.00' as unknown as number,
            simulatedAt: new Date('2026-10-01T18:00:00.000Z'),
            subscription: { id: 'sub-demo', organizationId: 'org-123', plan: mockDemoPlan },
            cardLast4: null,
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
          cardLast4: '4242',
          occurredAt: '2026-10-29T18:00:00.000Z',
        },
        {
          id: 'op-demo-uuid',
          type: 'charge',
          planName: 'Demo',
          amount: 0,
          simulated: true,
          cardLast4: null,
          occurredAt: '2026-10-01T18:00:00.000Z',
        },
      ]);
    });
  });

  describe('5 bis. Comprobante de operación (getReceipt — SPEC-306 Escenarios 1, 4 y 5)', () => {
    const receiptOperationId = '3f9a2c1b-8d7e-4f60-a1b2-c3d4e5f60718';

    const mockReceiptQuery = (result: unknown) => {
      const qb = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(result),
      };
      (billingOperationRepo.createQueryBuilder as jest.Mock).mockReturnValue(qb);
      return qb;
    };

    it('SPEC-306 Escenario 1: devuelve número derivado de operation_id, plan, tipo, importe, fecha y últimos cuatro dígitos', async () => {
      const qb = mockReceiptQuery({
        id: receiptOperationId,
        subscriptionId: 'sub-team',
        type: BillingOperationType.CHARGE,
        amount: '19.99' as unknown as number,
        simulatedAt: new Date('2026-10-29T18:00:00.000Z'),
        subscription: { id: 'sub-team', organizationId: 'org-123', plan: mockTeamPlan },
        cardLast4: '4242',
      });

      const receipt = await service.getReceipt('org-123', receiptOperationId);

      expect(receipt).toEqual({
        receiptNumber: 'NX-3F9A2C1B8D7E4F60A1B2C3D4E5F60718',
        planName: 'Team',
        type: 'charge',
        amount: 19.99,
        cardLast4: '4242',
        occurredAt: '2026-10-29T18:00:00.000Z',
      });
      expect(qb.where).toHaveBeenCalledWith('op.id = :operationId', { operationId: receiptOperationId });
      expect(qb.andWhere).toHaveBeenCalledWith('sub.organizationId = :organizationId', {
        organizationId: 'org-123',
      });
    });

    it('SPEC-306 Escenario 1: el número de comprobante es determinista para el mismo operation_id', async () => {
      mockReceiptQuery({
        id: receiptOperationId,
        type: BillingOperationType.RENEWAL,
        amount: '19.99' as unknown as number,
        simulatedAt: new Date('2026-10-29T18:00:00.000Z'),
        subscription: { id: 'sub-team', organizationId: 'org-123', plan: mockTeamPlan },
        cardLast4: null,
      });

      const first = await service.getReceipt('org-123', receiptOperationId);
      const second = await service.getReceipt('org-123', receiptOperationId);

      expect(first.receiptNumber).toBe(second.receiptNumber);
      expect(first.receiptNumber).toBe('NX-3F9A2C1B8D7E4F60A1B2C3D4E5F60718');
    });

    it('SPEC-306 Escenario 4: operación ajena o inexistente responde NotFound con código NOT_FOUND', async () => {
      mockReceiptQuery(null);

      const error = await service.getReceipt('org-123', receiptOperationId).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toEqual({
        code: 'NOT_FOUND',
        message: 'El comprobante no existe o no pertenece a tu organización.',
      });
    });

    it('SPEC-306 Escenario 4: un id que no es UUID responde NotFound sin consultar la base', async () => {
      const qb = mockReceiptQuery(null);

      await expect(service.getReceipt('org-123', 'no-es-uuid')).rejects.toBeInstanceOf(NotFoundException);
      expect(billingOperationRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(qb.getOne).not.toHaveBeenCalled();
    });

    it('SPEC-306 Escenario 5: operación sin tarjeta (Demo, US$0) devuelve cardLast4 null e importe 0', async () => {
      mockReceiptQuery({
        id: receiptOperationId,
        type: BillingOperationType.CHARGE,
        amount: '0.00' as unknown as number,
        simulatedAt: new Date('2026-10-01T18:00:00.000Z'),
        subscription: { id: 'sub-demo', organizationId: 'org-123', plan: mockDemoPlan },
        cardLast4: null,
      });

      const receipt = await service.getReceipt('org-123', receiptOperationId);

      expect(receipt.cardLast4).toBeNull();
      expect(receipt.amount).toBe(0);
      expect(receipt.planName).toBe('Demo');
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

      const renewed = await service.renewSubscription('org-123', approvedCard);

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
          cardLast4: '4242',
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

    it('Escenario 5: dos renovaciones seguidas suman dos periodos y escriben una operación renewal cada una', async () => {
      // PostgreSQL serializa las renovaciones con FOR UPDATE; aquí se comprueba la suma con un estado compartido
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
      const operations: BillingOperation[] = [];

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(activeTeam),
        create: jest.fn((cls: unknown, entity: unknown) => {
          if (cls === BillingOperation) operations.push(entity as BillingOperation);
          return entity;
        }),
        save: jest.fn((entity: unknown) => Promise.resolve(entity)),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(mockManager));

      await service.renewSubscription('org-123', approvedCard);
      const second = await service.renewSubscription('org-123', approvedCard);

      const lockedQuery = {
        where: { organizationId: 'org-123', status: SubscriptionStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      };
      expect(mockManager.findOne.mock.calls).toEqual([
        [Subscription, lockedQuery],
        [Subscription, lockedQuery],
      ]);
      // 2026-11-10 + 30 días = 2026-12-10; + 30 días más = 2027-01-09
      expect(second.id).toBe('sub-team-active');
      expect(second.expiresAt?.toISOString()).toBe('2027-01-09T00:00:00.000Z');
      expect(operations).toHaveLength(2);
      expect(operations.every((op) => op.type === BillingOperationType.RENEWAL && op.amount === 19.99)).toBe(true);
    });
  });

  describe('7. Pago simulado en la renovación (SPEC-305 Escenarios 4 y 6, spec §8)', () => {
    const buildActiveTeam = (): Subscription => ({
      id: 'sub-team-active',
      organizationId: 'org-123',
      planId: mockTeamPlan.id,
      plan: mockTeamPlan,
      status: SubscriptionStatus.ACTIVE,
      simulated: true,
      startDate: new Date('2026-10-11T00:00:00.000Z'),
      expiresAt: new Date('2026-11-10T00:00:00.000Z'),
      createdAt: new Date('2026-10-11T00:00:00.000Z'),
    });

    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-10-29T12:00:00.000Z') });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('Escenario 4: con la tarjeta rechazada responde 402, no guarda nada y la vigencia no cambia', async () => {
      const activeTeam = buildActiveTeam();
      const mockManager = {
        findOne: jest.fn().mockResolvedValue(activeTeam),
        create: jest.fn(),
        save: jest.fn(),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(mockManager));

      const error = await service.renewSubscription('org-123', declinedCard).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(PaymentDeclinedException);
      expect((error as PaymentDeclinedException).getStatus()).toBe(402);
      expect((error as PaymentDeclinedException).getResponse()).toMatchObject({ code: 'PAYMENT_DECLINED' });
      expect(mockManager.save).not.toHaveBeenCalled();
      expect(mockManager.create).not.toHaveBeenCalled();
      expect(activeTeam.expiresAt?.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    });

    it('Escenario 4: con la tarjeta aprobada renueva y la operación renewal guarda cardLast4 = 4242', async () => {
      const mockManager = {
        findOne: jest.fn().mockResolvedValue(buildActiveTeam()),
        create: jest.fn((_cls: unknown, entity: unknown) => entity),
        save: jest.fn((entity: unknown) => Promise.resolve(entity)),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(mockManager));

      const renewed = await service.renewSubscription('org-123', approvedCard);

      expect(renewed.expiresAt?.toISOString()).toBe('2026-12-10T00:00:00.000Z');
      expect(mockManager.create).toHaveBeenCalledWith(
        BillingOperation,
        expect.objectContaining({ type: BillingOperationType.RENEWAL, cardLast4: '4242' }),
      );
      // Solo se guardan los últimos 4 dígitos
      const written = JSON.stringify([mockManager.create.mock.calls, mockManager.save.mock.calls]);
      expect(written).not.toContain('4242 4242 4242 4242');
      expect(written).not.toContain('4242424242424242');
      expect(written).not.toMatch(/cvv|cardNumber/);
    });

    it('Escenario 6: renovar un plan de pago sin tarjeta responde 400 VALIDATION_ERROR sin guardar', async () => {
      const mockManager = {
        findOne: jest.fn().mockResolvedValue(buildActiveTeam()),
        create: jest.fn(),
        save: jest.fn(),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(mockManager));

      const error = await service.renewSubscription('org-123').catch((err: unknown) => err);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('spec §8: PLAN_NOT_RENEWABLE se devuelve antes de evaluar la tarjeta', async () => {
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

      // Con la tarjeta rechazada, la respuesta sigue siendo PLAN_NOT_RENEWABLE: la tarjeta no se evaluó
      const error = await service.renewSubscription('org-123', declinedCard).catch((err: unknown) => err);

      expect(error).not.toBeInstanceOf(PaymentDeclinedException);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({ code: 'PLAN_NOT_RENEWABLE' });
      expect(mockManager.save).not.toHaveBeenCalled();
    });
  });

  describe('SPEC-504: edición del catálogo', () => {
    let manager: { findOne: jest.Mock; save: jest.Mock };
    const asManager = (): EntityManager => manager as unknown as EntityManager;

    beforeEach(() => {
      manager = {
        findOne: jest.fn(),
        save: jest.fn((entity: Plan) => Promise.resolve(entity)),
      };
    });

    it('lockPlanForUpdate devuelve el plan y consulta con lock pessimistic_write', async () => {
      manager.findOne.mockResolvedValue(mockTeamPlan);

      const plan = await service.lockPlanForUpdate(asManager(), mockTeamPlan.id);

      expect(plan).toBe(mockTeamPlan);
      expect(manager.findOne).toHaveBeenCalledWith(
        Plan,
        expect.objectContaining({ where: { id: mockTeamPlan.id }, lock: { mode: 'pessimistic_write' } }),
      );
    });

    it('lockPlanForUpdate con plan inexistente lanza NotFoundException con code NOT_FOUND', async () => {
      manager.findOne.mockResolvedValue(null);

      const error = await service.lockPlanForUpdate(asManager(), 'plan-inexistente').catch((err: unknown) => err);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('lockPlanForUpdate sobre el plan Demo lanza UnprocessableEntityException PLAN_NOT_EDITABLE y no guarda', async () => {
      manager.findOne.mockResolvedValue(mockDemoPlan);

      const error = await service.lockPlanForUpdate(asManager(), mockDemoPlan.id).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({ code: 'PLAN_NOT_EDITABLE' });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('applyPlanChanges con solo priceCents cambia solo ese campo', async () => {
      const plan = { ...mockTeamPlan };
      const changes: PlanChanges = { priceCents: 4999 };

      const saved = await service.applyPlanChanges(asManager(), plan, changes);

      expect(manager.save).toHaveBeenCalledWith(plan);
      expect(saved.priceCents).toBe(4999);
      expect(saved).toMatchObject({
        storageLimitBytes: mockTeamPlan.storageLimitBytes,
        maxMembers: mockTeamPlan.maxMembers,
        description: mockTeamPlan.description,
      });
    });

    it('applyPlanChanges con storageLimitBytes guarda el string en bytes (150 GB)', async () => {
      const plan = { ...mockTeamPlan };
      const changes: PlanChanges = { storageLimitBytes: (150n * 1_000_000_000n).toString() };

      const saved = await service.applyPlanChanges(asManager(), plan, changes);

      expect(saved.storageLimitBytes).toBe('150000000000');
      expect(manager.save).toHaveBeenCalledWith(expect.objectContaining({ storageLimitBytes: '150000000000' }));
    });

    it('applyPlanChanges con maxMembers y description actualiza esos campos', async () => {
      const plan = { ...mockTeamPlan };
      const changes: PlanChanges = { maxMembers: 25, description: 'Para equipos grandes' };

      const saved = await service.applyPlanChanges(asManager(), plan, changes);

      expect(saved).toMatchObject({
        maxMembers: 25,
        description: 'Para equipos grandes',
        priceCents: mockTeamPlan.priceCents,
        storageLimitBytes: mockTeamPlan.storageLimitBytes,
      });
    });

    it('applyPlanChanges sin cambios definidos no altera los campos del plan', async () => {
      const plan = { ...mockTeamPlan };

      const saved = await service.applyPlanChanges(asManager(), plan, {});
      expect(saved).toEqual(mockTeamPlan);

      const undefinedChanges: PlanChanges = { priceCents: undefined, maxMembers: undefined };
      const savedWithUndefined = await service.applyPlanChanges(asManager(), plan, undefinedChanges);
      expect(savedWithUndefined.priceCents).toBe(mockTeamPlan.priceCents);
      expect(savedWithUndefined.maxMembers).toBe(mockTeamPlan.maxMembers);
    });
  });
});
