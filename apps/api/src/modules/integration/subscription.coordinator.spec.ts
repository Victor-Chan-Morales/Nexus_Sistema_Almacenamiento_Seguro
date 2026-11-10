import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SubscriptionCoordinator } from './subscription.coordinator';
import { BillingService } from '../billing/billing.service';
import { FilesService } from '../files/files.service';
import { Plan, StorageLocation } from '../billing/entities/plan.entity';
import { Subscription, SubscriptionStatus } from '../billing/entities/subscription.entity';
import * as simulatedPayment from '../billing/simulated-payment';
import { PaymentDeclinedException, PaymentInput } from '../billing/simulated-payment';

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

  // Tarjetas de prueba de SPEC-305
  const approvedCard: PaymentInput = {
    cardNumber: '4242 4242 4242 4242',
    holderName: 'Ana Pérez',
    expiry: '12/99',
    cvv: '987',
  };
  const declinedCard: PaymentInput = { ...approvedCard, cardNumber: '4000 0000 0000 0002' };
  const otherCard: PaymentInput = { ...approvedCard, cardNumber: '5555 5555 5555 4444' };
  const emptyUsage = { usedBytes: BigInt(0), reservedBytes: BigInt(0), totalBytes: BigInt(0) };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    billingService = {
      findPlanById: jest.fn(),
      persistSubscription: jest.fn(),
      recordOperation: jest.fn(),
    };

    filesService = {
      getTotalStorageUsage: jest.fn(),
    };

    dataSource = {
      transaction: jest.fn(async (callback: any) => {
        const mockManager = {
          findOne: jest.fn(),
          save: jest.fn(),
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
      expect(billingService.persistSubscription).not.toHaveBeenCalled();
    });

    it('Escenario 2: al activar un plan nuevo (Team US$19.99) unifica la persistencia delegando en persistSubscription', async () => {
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockTeamPlan);
      (filesService.getTotalStorageUsage as jest.Mock).mockResolvedValue({
        usedBytes: BigInt(0),
        reservedBytes: BigInt(0),
        totalBytes: BigInt(0),
      });

      const mockSavedSub = {
        id: 'new-team-sub',
        planId: mockTeamPlan.id,
        status: SubscriptionStatus.ACTIVE,
      } as Subscription;
      (billingService.persistSubscription as jest.Mock).mockResolvedValue(mockSavedSub);

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(null),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(mockManager));

      const result = await coordinator.activateSubscription('org-test-uuid', mockTeamPlan.id, approvedCard);

      expect(result.id).toBe('new-team-sub');
      expect(billingService.persistSubscription).toHaveBeenCalledWith(
        'org-test-uuid',
        mockTeamPlan,
        mockManager,
        '4242',
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
      expect(billingService.persistSubscription).not.toHaveBeenCalled();
    });

    it('debe permitir el downgrade si usedBytes + reservedBytes cabe dentro del límite y delegar en persistSubscription (Escenario 2b)', async () => {
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

      const mockSavedDemo = {
        id: 'new-demo-sub',
        planId: mockDemoPlan.id,
        status: SubscriptionStatus.ACTIVE,
      } as Subscription;
      (billingService.persistSubscription as jest.Mock).mockResolvedValue(mockSavedDemo);

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(activeTeam),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: any) => cb(mockManager));

      const result = await coordinator.activateSubscription('org-test-uuid', mockDemoPlan.id);

      expect(result).toBeDefined();
      expect(result.status).toBe(SubscriptionStatus.ACTIVE);
      expect(billingService.persistSubscription).toHaveBeenCalledWith(
        'org-test-uuid',
        mockDemoPlan,
        mockManager,
        null,
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

      expect(billingService.persistSubscription).not.toHaveBeenCalled();
    });
  });

  describe('3. Concurrencia y Colisión de Índice Único Parcial', () => {
    it('debe propagar ConflictException si persistSubscription detecta colisión concurrente (23505)', async () => {
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockTeamPlan);

      (filesService.getTotalStorageUsage as jest.Mock).mockResolvedValue({
        usedBytes: BigInt(0),
        reservedBytes: BigInt(0),
        totalBytes: BigInt(0),
      });

      (billingService.persistSubscription as jest.Mock).mockRejectedValue(
        new ConflictException({
          code: 'CONCURRENT_SUBSCRIPTION_CONFLICT',
          message: 'Ya existe una suscripción activa para esta organización.',
        }),
      );

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(null),
      };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: any) => cb(mockManager));

      await expect(
        coordinator.activateSubscription('org-test-uuid', mockTeamPlan.id, approvedCard),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('4. Pago simulado con tarjetas de prueba (SPEC-305)', () => {
    const givenNoActiveSubscription = (): { findOne: jest.Mock } => {
      const mockManager = { findOne: jest.fn().mockResolvedValue(null) };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(mockManager));
      return mockManager;
    };

    beforeEach(() => {
      (filesService.getTotalStorageUsage as jest.Mock).mockResolvedValue(emptyUsage);
      (billingService.persistSubscription as jest.Mock).mockResolvedValue({
        id: 'new-sub',
        status: SubscriptionStatus.ACTIVE,
      } as Subscription);
    });

    it('Escenario 1: con la tarjeta aprobada persiste la suscripción con cardLast4 = 4242', async () => {
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockTeamPlan);
      const mockManager = givenNoActiveSubscription();

      await coordinator.activateSubscription('org-test-uuid', mockTeamPlan.id, approvedCard);

      expect(billingService.persistSubscription).toHaveBeenCalledWith('org-test-uuid', mockTeamPlan, mockManager, '4242');
    });

    it('Escenario 2: con la tarjeta rechazada lanza PaymentDeclinedException (402) y no persiste', async () => {
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockTeamPlan);
      givenNoActiveSubscription();

      const error = await coordinator
        .activateSubscription('org-test-uuid', mockTeamPlan.id, declinedCard)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(PaymentDeclinedException);
      expect((error as PaymentDeclinedException).getStatus()).toBe(402);
      expect((error as PaymentDeclinedException).getResponse()).toMatchObject({ code: 'PAYMENT_DECLINED' });
      expect(billingService.persistSubscription).not.toHaveBeenCalled();
    });

    it('Escenario 3: con otra tarjeta responde 422 TEST_CARD_REQUIRED, advierte no usar tarjetas reales y no persiste', async () => {
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockTeamPlan);
      givenNoActiveSubscription();

      const error = await coordinator
        .activateSubscription('org-test-uuid', mockTeamPlan.id, otherCard)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        code: 'TEST_CARD_REQUIRED',
        message: expect.stringContaining('No uses tarjetas reales'),
      });
      expect(billingService.persistSubscription).not.toHaveBeenCalled();
    });

    it('Escenario 5: un plan de US$0 no exige tarjeta y persiste con cardLast4 null', async () => {
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockDemoPlan);
      const mockManager = givenNoActiveSubscription();

      await coordinator.activateSubscription('org-test-uuid', mockDemoPlan.id);

      expect(billingService.persistSubscription).toHaveBeenCalledWith('org-test-uuid', mockDemoPlan, mockManager, null);
    });

    it('Escenario 5: reactivar el plan de pago vigente no exige tarjeta ni persiste', async () => {
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockTeamPlan);
      const resolveSpy = jest.spyOn(simulatedPayment, 'resolveSimulatedPayment');
      const existingActive = {
        id: 'existing-active-team',
        organizationId: 'org-test-uuid',
        planId: mockTeamPlan.id,
        status: SubscriptionStatus.ACTIVE,
      } as Subscription;
      const mockManager = { findOne: jest.fn().mockResolvedValue(existingActive) };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(mockManager));

      const result = await coordinator.activateSubscription('org-test-uuid', mockTeamPlan.id);

      expect(result.id).toBe('existing-active-team');
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(billingService.persistSubscription).not.toHaveBeenCalled();
    });

    it('Escenario 6: un plan de pago sin payment responde 400 VALIDATION_ERROR y no persiste', async () => {
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockTeamPlan);
      givenNoActiveSubscription();

      const error = await coordinator
        .activateSubscription('org-test-uuid', mockTeamPlan.id)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(billingService.persistSubscription).not.toHaveBeenCalled();
    });

    it('Escenario 7: si la cuota no cabe responde 422 STORAGE_QUOTA_EXCEEDED sin evaluar la tarjeta ni persistir', async () => {
      // Plan de pago pequeño: el uso actual (6 GB) no cabe en sus 5 GB
      const smallPaidPlan: Plan = { ...mockTeamPlan, id: 'plan-small-uuid', storageLimitBytes: '5000000000' };
      (billingService.findPlanById as jest.Mock).mockResolvedValue(smallPaidPlan);
      (filesService.getTotalStorageUsage as jest.Mock).mockResolvedValue({
        usedBytes: BigInt(6000000000),
        reservedBytes: BigInt(0),
        totalBytes: BigInt(6000000000),
      });
      const resolveSpy = jest.spyOn(simulatedPayment, 'resolveSimulatedPayment');
      const simulateSpy = jest.spyOn(simulatedPayment, 'simulatePayment');
      const activeTeam = { id: 'active-team', planId: mockTeamPlan.id, status: SubscriptionStatus.ACTIVE } as Subscription;
      const mockManager = { findOne: jest.fn().mockResolvedValue(activeTeam) };
      (dataSource.transaction as jest.Mock).mockImplementation((cb: (m: unknown) => Promise<unknown>) => cb(mockManager));

      // Incluso con la tarjeta rechazada, gana la cuota
      const error = await coordinator
        .activateSubscription('org-test-uuid', smallPaidPlan.id, declinedCard)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' });
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(simulateSpy).not.toHaveBeenCalled();
      expect(billingService.persistSubscription).not.toHaveBeenCalled();
    });

    it('Escenario 8: el número completo y el CVV no aparecen en la persistencia, en los errores ni en los logs', async () => {
      const loggerSpies = (['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const).map((method) =>
        jest.spyOn(Logger.prototype, method).mockImplementation(() => undefined),
      );
      const expectClean = (value: unknown): void => {
        const serialized = JSON.stringify(value) ?? '';
        expect(serialized).not.toContain(approvedCard.cardNumber);
        expect(serialized).not.toMatch(/4242\s?4242\s?4242\s?4242|4000\s?0000\s?0000\s?0002|5555/);
        expect(serialized).not.toMatch(new RegExp(`(^|\\D)${approvedCard.cvv}(\\D|$)`));
        expect(serialized).not.toMatch(/cvv|cardNumber/i);
      };
      const errors: unknown[] = [];
      const capture = (err: unknown): void => {
        errors.push(err instanceof HttpException ? err.getResponse() : String(err));
      };
      (billingService.findPlanById as jest.Mock).mockResolvedValue(mockTeamPlan);
      givenNoActiveSubscription();

      // Aprobada, rechazada, otra tarjeta, vencimiento inválido y falla de Files (que sí escribe en el log)
      await coordinator.activateSubscription('org-test-uuid', mockTeamPlan.id, approvedCard);
      await coordinator.activateSubscription('org-test-uuid', mockTeamPlan.id, declinedCard).catch(capture);
      await coordinator.activateSubscription('org-test-uuid', mockTeamPlan.id, otherCard).catch(capture);
      await coordinator
        .activateSubscription('org-test-uuid', mockTeamPlan.id, { ...approvedCard, expiry: '01/20' })
        .catch(capture);
      (filesService.getTotalStorageUsage as jest.Mock).mockRejectedValueOnce(new Error('Files database timeout'));
      await coordinator.activateSubscription('org-test-uuid', mockTeamPlan.id, approvedCard).catch(capture);

      expect(errors).toHaveLength(4);
      // persistSubscription solo recibe la organización, el plan, el EntityManager y los últimos 4 dígitos
      const persistCalls = (billingService.persistSubscription as jest.Mock).mock.calls;
      expect(persistCalls).toHaveLength(1);
      expect(persistCalls[0][0]).toBe('org-test-uuid');
      expect(persistCalls[0][1]).toBe(mockTeamPlan);
      expect(persistCalls[0][3]).toBe('4242');
      expect(persistCalls[0]).toHaveLength(4);
      expectClean(errors);
      // Mensajes del Logger (el segundo argumento es la traza de la pila, sin datos de la solicitud)
      expect(loggerSpies.some((spy) => spy.mock.calls.length > 0)).toBe(true);
      loggerSpies.forEach((spy) => expectClean(spy.mock.calls.map((call) => call[0])));
    });
  });
});
