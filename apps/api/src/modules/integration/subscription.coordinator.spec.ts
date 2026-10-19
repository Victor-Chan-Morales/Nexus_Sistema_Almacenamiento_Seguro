import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { SubscriptionCoordinator } from './subscription.coordinator';
import { BillingService } from '../billing/billing.service';
import { FilesService } from '../files/files.service';
import { Plan, StorageLocation } from '../billing/entities/plan.entity';
import { Subscription, SubscriptionStatus } from '../billing/entities/subscription.entity';

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
    it('debe ser idempotente si ya existe suscripción activa al mismo plan (no recrea filas)', async () => {
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
    });
  });

  describe('2. Coordinación de Downgrade y Falla Segura (Fail-Safe)', () => {
    it('debe rechazar el downgrade con ConflictException si usedBytes + reservedBytes supera el nuevo plan', async () => {
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

      await expect(
        coordinator.activateSubscription('org-test-uuid', mockDemoPlan.id),
      ).rejects.toThrow(ConflictException);

      expect(filesService.getTotalStorageUsage).toHaveBeenCalledWith('org-test-uuid');
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('debe permitir el downgrade si usedBytes + reservedBytes cabe dentro del límite', async () => {
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
    it('debe capturar error 23505 (uq_active_org_subscription) y responder con ConflictException', async () => {
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockTeamPlan);

      (filesService.getTotalStorageUsage as jest.Mock).mockResolvedValue({
        usedBytes: BigInt(0),
        reservedBytes: BigInt(0),
        totalBytes: BigInt(0),
      });

      const uniqueViolationError = new Error('duplicate key value violates unique constraint "uq_active_org_subscription"');
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
