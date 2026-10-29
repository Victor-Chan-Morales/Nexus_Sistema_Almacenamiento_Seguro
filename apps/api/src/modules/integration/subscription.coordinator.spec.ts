import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  ConflictException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SubscriptionCoordinator } from './subscription.coordinator';
import { BillingService } from '../billing/billing.service';
import { FilesService } from '../files/files.service';
import { Plan, StorageLocation } from '../billing/entities/plan.entity';
import { Subscription, SubscriptionStatus } from '../billing/entities/subscription.entity';
import { BillingOperation, BillingOperationType } from '../billing/entities/billing-operation.entity';

describe('SubscriptionCoordinator — Pruebas de orquestación, concurrencia y fail-safe', () => {
  let coordinator: SubscriptionCoordinator;
  let billingService: jest.Mocked<Partial<BillingService>>;
  let filesService: jest.Mocked<Partial<FilesService>>;
  let dataSource: Partial<DataSource>;

  const mockDemoPlan: Plan = {
    id: 'plan-demo-uuid',
    name: 'Demo',
    description: 'Espacio pequeño',
    priceCents: 0,
    storageLimitBytes: '5000000000', // 5 GB
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
    storageLimitBytes: '100000000000', // 100 GB
    maxMembers: 10,
    validityDays: 30,
    storageLocation: StorageLocation.CLOUD,
    active: true,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    billingService = {
      findPlanById: jest.fn(),
      recordOperation: jest.fn().mockResolvedValue({
        id: 'op-simulated-uuid',
        type: BillingOperationType.CHARGE,
        amount: 0,
        simulatedAt: new Date(),
        simulated: true,
      } as BillingOperation),
    };

    filesService = {
      getTotalStorageUsage: jest.fn(),
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
        SubscriptionCoordinator,
        { provide: BillingService, useValue: billingService },
        { provide: FilesService, useValue: filesService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    coordinator = module.get<SubscriptionCoordinator>(SubscriptionCoordinator);
  });

  describe('1. Idempotencia y Transaccionalidad', () => {
    it('debe ser idempotente si ya existe suscripción activa al mismo plan (no recrea filas ni operación — Escenario 3)', async () => {
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockTeamPlan);

      const existingActive: Subscription = {
        id: 'existing-active-team',
        organizationId: 'org-test-uuid',
        planId: mockTeamPlan.id,
        plan: mockTeamPlan,
        status: SubscriptionStatus.ACTIVE,
        simulated: true,
        expiresAt: new Date(Date.now() + 86400000 * 20),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(existingActive),
        save: jest.fn(),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: any) => cb(mockManager));

      const result = await coordinator.activateSubscription('org-test-uuid', mockTeamPlan.id);

      expect(result.id).toBe('existing-active-team');
      expect(mockManager.save).not.toHaveBeenCalled();
      expect(billingService.recordOperation).not.toHaveBeenCalled();
    });

    it('Escenario 2: al activar un plan nuevo (Team US$19.99) escribe una operación charge con amount 19.99 en la misma transacción', async () => {
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockTeamPlan);
      (filesService.getTotalStorageUsage as jest.Mock).mockResolvedValue({
        usedBytes: BigInt(0),
        reservedBytes: BigInt(0),
        totalBytes: BigInt(0),
      });

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((_cls: unknown, entity: unknown) => entity),
        save: jest.fn((entity: Record<string, unknown>) =>
          Promise.resolve({ id: 'new-team-sub', createdAt: new Date(), ...entity }),
        ),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(mockManager));

      const result = await coordinator.activateSubscription('org-test-uuid', mockTeamPlan.id);

      expect(result.id).toBe('new-team-sub');
      expect(billingService.recordOperation).toHaveBeenCalledWith(
        mockManager,
        expect.objectContaining({ id: 'new-team-sub', planId: mockTeamPlan.id }),
        BillingOperationType.CHARGE,
        19.99,
      );
    });
  });

  describe('2. Coordinación de Downgrade y Falla Segura (Fail-Safe)', () => {
    it('debe rechazar el downgrade con 422 STORAGE_QUOTA_EXCEEDED si usedBytes + reservedBytes supera el nuevo plan', async () => {
      // Intenta cambiar a Demo (5 GB = 5000000000 bytes)
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockDemoPlan);

      const activeTeam: Subscription = {
        id: 'active-team',
        organizationId: 'org-test-uuid',
        planId: mockTeamPlan.id,
        plan: mockTeamPlan,
        status: SubscriptionStatus.ACTIVE,
        simulated: true,
        expiresAt: new Date(Date.now() + 86400000 * 10),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Files reporta 4 GB en uso y 2 GB en reservas activas (Total = 6 GB > 5 GB)
      (filesService.getTotalStorageUsage as jest.Mock).mockResolvedValue({
        usedBytes: BigInt(4000000000),
        reservedBytes: BigInt(2000000000),
        totalBytes: BigInt(6000000000),
      });

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(activeTeam),
        save: jest.fn(),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: any) => cb(mockManager));

      // CONTRACTS.md: la cuota insuficiente es 422 (regla de negocio), no 409 (conflicto de estado).
      const error = await coordinator
        .activateSubscription('org-test-uuid', mockDemoPlan.id)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getStatus()).toBe(422);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        code: 'STORAGE_QUOTA_EXCEEDED',
      });

      // El uso se lee dentro de la transacción, con el mismo EntityManager: el downgrade
      // debe evaluarse bajo el bloqueo de cuota, no con una lectura suelta previa.
      expect(filesService.getTotalStorageUsage).toHaveBeenCalledWith('org-test-uuid', mockManager);
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('debe permitir el downgrade si usedBytes + reservedBytes cabe dentro del límite y registrar charge con amount 0 (Escenario 2b)', async () => {
      // Intenta cambiar a Demo (5 GB)
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockDemoPlan);

      const activeTeam: Subscription = {
        id: 'active-team',
        organizationId: 'org-test-uuid',
        planId: mockTeamPlan.id,
        plan: mockTeamPlan,
        status: SubscriptionStatus.ACTIVE,
        simulated: true,
        expiresAt: new Date(Date.now() + 86400000 * 10),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Files reporta 2 GB en uso y 1 GB en reservas activas (Total = 3 GB <= 5 GB)
      (filesService.getTotalStorageUsage as jest.Mock).mockResolvedValue({
        usedBytes: BigInt(2000000000),
        reservedBytes: BigInt(1000000000),
        totalBytes: BigInt(3000000000),
      });

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(activeTeam),
        create: jest.fn((_cls, entity) => entity),
        save: jest.fn((entity) => Promise.resolve({ id: 'new-demo-sub', createdAt: new Date(), ...entity })),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: any) => cb(mockManager));

      const result = await coordinator.activateSubscription('org-test-uuid', mockDemoPlan.id);

      expect(result).toBeDefined();
      expect(result.status).toBe(SubscriptionStatus.ACTIVE);
      // Se canceló la anterior
      expect(activeTeam.status).toBe(SubscriptionStatus.CANCELLED);
      expect(mockManager.save).toHaveBeenCalledTimes(2); // cancel anterior + insert nueva
      expect(billingService.recordOperation).toHaveBeenCalledWith(
        mockManager,
        expect.objectContaining({ id: 'new-demo-sub', planId: mockDemoPlan.id }),
        BillingOperationType.CHARGE,
        0,
      );
    });

    it('Falla Segura: si FilesModule arroja un error, aborta la transacción y NUNCA asume 0 bytes', async () => {
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockDemoPlan);

      const activeTeam: Subscription = {
        id: 'active-team',
        organizationId: 'org-test-uuid',
        planId: mockTeamPlan.id,
        plan: mockTeamPlan,
        status: SubscriptionStatus.ACTIVE,
        simulated: true,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Files falla (ej. error de base de datos o timeout)
      (filesService.getTotalStorageUsage as jest.Mock).mockRejectedValue(
        new Error('Files database timeout'),
      );

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(activeTeam),
        save: jest.fn(),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: any) => cb(mockManager));

      await expect(
        coordinator.activateSubscription('org-test-uuid', mockDemoPlan.id),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockManager.save).not.toHaveBeenCalled();
    });
  });

  describe('3. Concurrencia y Colisión de Índice Único Parcial', () => {
    it('debe capturar error 23505 (uq_subscription_one_active_per_organization) y responder con ConflictException', async () => {
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockTeamPlan);

      (filesService.getTotalStorageUsage as jest.Mock).mockResolvedValue({
        usedBytes: BigInt(0),
        reservedBytes: BigInt(0),
        totalBytes: BigInt(0),
      });

      const uniqueViolationError = new Error('duplicate key value violates unique constraint "uq_subscription_one_active_per_organization"');
      (uniqueViolationError as any).code = '23505';

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((_cls, entity) => entity),
        save: jest.fn().mockRejectedValue(uniqueViolationError),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: any) => cb(mockManager));

      await expect(
        coordinator.activateSubscription('org-test-uuid', mockTeamPlan.id),
      ).rejects.toThrow(ConflictException);
    });
  });
});
