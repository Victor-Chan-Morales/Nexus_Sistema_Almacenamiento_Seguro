import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Plan } from './entities/plan.entity';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';
import {
  BillingOperation,
  BillingOperationType,
} from './entities/billing-operation.entity';
import { BillingOperationItemResponse, BillingReceiptData } from './billing.dto';
import { priceUsd, todayUtcDate } from './billing.utils';
import { PaymentInput, resolveSimulatedPayment } from './simulated-payment';

/** SPEC-306 D3: un id que no es UUID se trata como inexistente, sin consultar la base. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SPEC-306 D2: número de comprobante derivado de operation_id (función pura, única fuente del formato). */
function deriveReceiptNumber(operationId: string): string {
  return `NX-${operationId.replace(/-/g, '').toUpperCase()}`;
}

/** SPEC-306: la misma respuesta para una operación inexistente, ajena o con id mal formado. */
function receiptNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'NOT_FOUND',
    message: 'El comprobante no existe o no pertenece a tu organización.',
  });
}

/**
 * BillingService — Lógica de dominio para planes, cuotas y persistencia de suscripciones.
 *
 * Arquitectura Monolítica Modular:
 *   - No inyecta FilesModule ni StorageUsagePort (cero acoplamiento dinámico o ModuleRef).
 *   - La coordinación de downgrades y verificación de cuota cruzada se realiza a través
 *     del SubscriptionCoordinator de integración.
 */
@Injectable()
export class BillingService implements OnModuleInit {
  constructor(
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,

    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,

    private readonly dataSource: DataSource,

    @InjectRepository(BillingOperation)
    private readonly billingOperationRepo: Repository<BillingOperation>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.validatePlanCatalog();
  }

  /** The SQL migration is the single source of catalog data; startup verifies it exists. */
  async validatePlanCatalog(): Promise<void> {
    for (const name of ['Demo', 'Team', 'Business', 'Enterprise']) {
      const plan = await this.planRepo.findOneBy({ name });
      if (!plan) {
        throw new NotFoundException(`El plan ${name} no está en el catálogo; aplica las migraciones de Billing`);
      }
    }
  }

  /** @deprecated Kept for callers from the previous Billing API; catalog data comes from migrations. */
  async seedDefaultPlans(): Promise<void> {
    await this.validatePlanCatalog();
  }

  async listPlans(): Promise<Plan[]> {
    return this.planRepo.find({
      order: { priceCents: 'ASC' },
    });
  }

  async findPlanById(planId: string): Promise<Plan> {
    const plan = await this.planRepo.findOneBy({ id: planId });
    if (!plan) {
      throw new NotFoundException('El plan solicitado no existe');
    }
    return plan;
  }

  async getDemoPlan(): Promise<Plan> {
    const demo = await this.planRepo.findOneBy({ name: 'Demo' });
    if (!demo) {
      throw new NotFoundException('El Plan Demo no se encuentra registrado en el catálogo');
    }
    return demo;
  }

  // ── Historial de Operaciones de Facturación Simulada (SPEC-301) ───────────

  async recordOperation(
    manager: EntityManager,
    subscription: Subscription,
    type: BillingOperationType,
    amount: number,
    cardLast4: string | null = null,
  ): Promise<BillingOperation> {
    // SPEC-305: solo se guardan los últimos 4 dígitos de la tarjeta de prueba aprobada
    const operation = manager.create(BillingOperation, {
      subscriptionId: subscription.id,
      type,
      amount: Number(amount),
      simulatedAt: new Date(),
      cardLast4,
    });
    return manager.save(operation);
  }

  async listOperations(organizationId: string): Promise<BillingOperationItemResponse[]> {
    const operations = await this.billingOperationRepo
      .createQueryBuilder('op')
      .innerJoinAndSelect('op.subscription', 'sub')
      .innerJoinAndSelect('sub.plan', 'plan')
      .where('sub.organizationId = :organizationId', { organizationId })
      .orderBy('op.simulatedAt', 'DESC')
      .take(100)
      .getMany();

    return operations.map((op) => ({
      id: op.id,
      type: op.type,
      planName: op.subscription?.plan?.name ?? '',
      amount: Number(op.amount ?? 0),
      simulated: true as const,
      cardLast4: op.cardLast4 ?? null,
      occurredAt:
        op.simulatedAt instanceof Date
          ? op.simulatedAt.toISOString()
          : new Date(op.simulatedAt).toISOString(),
    }));
  }

  /**
   * SPEC-306: comprobante de una operación de la organización indicada.
   * La consulta filtra por sub.organizationId: una operación ajena responde igual que una inexistente.
   * El organizationName no sale de aquí; lo agrega el controlador desde la sesión.
   */
  async getReceipt(organizationId: string, operationId: string): Promise<BillingReceiptData> {
    if (!UUID_PATTERN.test(operationId)) {
      throw receiptNotFound();
    }

    const operation = await this.billingOperationRepo
      .createQueryBuilder('op')
      .innerJoinAndSelect('op.subscription', 'sub')
      .innerJoinAndSelect('sub.plan', 'plan')
      .where('op.id = :operationId', { operationId })
      .andWhere('sub.organizationId = :organizationId', { organizationId })
      .getOne();

    if (!operation) {
      throw receiptNotFound();
    }

    return {
      receiptNumber: deriveReceiptNumber(operation.id),
      planName: operation.subscription?.plan?.name ?? '',
      type: operation.type,
      amount: Number(operation.amount ?? 0),
      cardLast4: operation.cardLast4 ?? null,
      occurredAt:
        operation.simulatedAt instanceof Date
          ? operation.simulatedAt.toISOString()
          : new Date(operation.simulatedAt).toISOString(),
    };
  }

  // ── Provisión Inicial Atómica (Hook de Registro de IAM) ───────────────────

  /**
   * Provisiona de forma atómica la suscripción Demo inicial para una organización.
   * Se ejecuta compartiendo el EntityManager de la transacción de registro de IAM.
   */
  async provisionInitialSubscription(
    organizationId: string,
    transactionalManager?: EntityManager,
  ): Promise<Subscription> {
    const execute = async (manager: EntityManager): Promise<Subscription> => {
      const demoPlan = await manager.findOne(Plan, { where: { name: 'Demo' } });
      if (!demoPlan) {
        throw new NotFoundException('El plan Demo no está en el catálogo; aplica las migraciones de Billing');
      }

      // Idempotencia: si ya existe una suscripción activa (ej. reintento), retornarla
      const existing = await manager.findOne(Subscription, {
        where: { organizationId, status: SubscriptionStatus.ACTIVE },
        relations: ['plan'],
      });
      if (existing) {
        return existing;
      }

      const subscription = manager.create(Subscription, {
        organizationId,
        planId: demoPlan.id,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date(),
        simulated: true, // Sin cobro real
        expiresAt: null, // Demo sin vencimiento
      });

      const saved = await manager.save(subscription);
      saved.plan = demoPlan;
      await this.recordOperation(manager, saved, BillingOperationType.CHARGE, 0);
      return saved;
    };

    if (transactionalManager) {
      return execute(transactionalManager);
    }
    return this.dataSource.transaction(execute);
  }

  // ── Ciclo de Vida y Transaccionalidad de Suscripciones ────────────────────

  /**
   * Consulta la suscripción activa evaluando expiración temporal.
   * Si la fecha expiró, actualiza el estado a EXPIRED en BD y retorna null.
   */
  async getActiveSubscription(
    organizationId: string,
    manager?: EntityManager,
  ): Promise<Subscription | null> {
    const repo = manager ? manager.getRepository(Subscription) : this.subscriptionRepo;
    const sub = await repo.findOne({
      where: { organizationId, status: SubscriptionStatus.ACTIVE },
      relations: ['plan'],
      order: { createdAt: 'DESC' },
    });

    if (!sub) return null;

    if (this.isExpired(sub)) {
      sub.status = SubscriptionStatus.EXPIRED;
      await repo.save(sub);
      return null;
    }

    return sub;
  }

  /**
   * Lectura pura de la suscripción vigente: no escribe. Una suscripción vencida se devuelve como null y su
   * estado no se corrige aquí; lo corrige getActiveSubscription en una consulta que sí persiste.
   * Para lecturas que no deben escribir, como el límite de miembros de IAM (GET /organizations/members).
   */
  async getActiveSubscriptionReadOnly(organizationId: string): Promise<Subscription | null> {
    const sub = await this.subscriptionRepo.findOne({
      where: { organizationId, status: SubscriptionStatus.ACTIVE },
      relations: ['plan'],
      order: { createdAt: 'DESC' },
    });
    return sub && !this.isExpired(sub) ? sub : null;
  }

  private isExpired(sub: Subscription): boolean {
    const todayUtc = todayUtcDate();
    const endDate = sub.expiresAt ? todayUtcDate(sub.expiresAt) : undefined;
    return Boolean(endDate && endDate <= todayUtc);
  }

  /**
   * Retorna únicamente la suscripción vigente (o null) para la organización,
   * omitiendo el historial de suscripciones canceladas o vencidas (CONTRACTS.md v0.3).
   */
  async getSubscription(organizationId: string): Promise<Subscription | null> {
    return this.getActiveSubscription(organizationId);
  }

  /**
   * SPEC-114: Cancela la suscripción activa de una organización fijando status = 'cancelled' y end_date = CURRENT_DATE.
   */
  async cancelActive(organizationId: string, transactionalManager?: EntityManager): Promise<void> {
    const execute = async (manager: EntityManager): Promise<void> => {
      // loadEagerRelations: false evita el LEFT JOIN de `plan`, que Postgres no admite con FOR UPDATE.
      const active = await manager.findOne(Subscription, {
        where: { organizationId, status: SubscriptionStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });
      if (active) {
        active.status = SubscriptionStatus.CANCELLED;
        active.expiresAt = new Date();
        await manager.save(active);
      }
    };
    if (transactionalManager) {
      await execute(transactionalManager);
    } else {
      await this.dataSource.transaction(execute);
    }
  }

  /**
   * Persiste transaccionalmente el cambio o activación de suscripción.
   * Cancela la suscripción activa previa y guarda la nueva de forma atómica.
   * Captura específicamente la colisión del índice único parcial
   * (uq_subscription_one_active_per_organization, código 23505)
   * y lo devuelve como ConflictException controlado.
   * `cardLast4` llega ya resuelto por el pago simulado (SPEC-305); null en planes de US$0.
   */
  async persistSubscription(
    organizationId: string,
    targetPlan: Plan,
    transactionalManager?: EntityManager,
    cardLast4: string | null = null,
  ): Promise<Subscription> {
    const execute = async (manager: EntityManager): Promise<Subscription> => {
      try {
        // Bloqueo pesimista de escritura para evitar carreras concurrentes en la misma organización
        const currentActive = await manager.findOne(Subscription, {
          where: { organizationId, status: SubscriptionStatus.ACTIVE },
          lock: { mode: 'pessimistic_write' },
          loadEagerRelations: false,
        });

        // Idempotencia: Si ya está activo el mismo plan, retornar el registro existente sin recrear
        if (currentActive && currentActive.planId === targetPlan.id) {
          currentActive.plan = targetPlan;
          return currentActive;
        }

        // Cancelar suscripción previa activa
        if (currentActive) {
          currentActive.status = SubscriptionStatus.CANCELLED;
          await manager.save(currentActive);
        }

        const startDate = new Date();
        const expiresAt = (targetPlan.validityDays && targetPlan.validityDays > 0)
          ? new Date(startDate.getTime() + targetPlan.validityDays * 86400000)
          : null;

        const newSubscription = manager.create(Subscription, {
          organizationId,
          planId: targetPlan.id,
          status: SubscriptionStatus.ACTIVE,
          startDate,
          simulated: true, // Sin pasarelas de pago ni tarjetas reales
          expiresAt,
        });

        const saved = await manager.save(newSubscription);
        saved.plan = targetPlan;
        const amountUsd = priceUsd(targetPlan);
        await this.recordOperation(
          manager,
          saved,
          BillingOperationType.CHARGE,
          amountUsd,
          cardLast4,
        );
        return saved;
      } catch (error: any) {
        if (error?.code === '23505' || error?.driverError?.code === '23505') {
          throw new ConflictException({
            code: 'CONCURRENT_SUBSCRIPTION_CONFLICT',
            message: 'Ya existe una suscripción activa para esta organización o hay una operación concurrente en curso.',
          });
        }
        throw error;
      }
    };

    if (transactionalManager) {
      return execute(transactionalManager);
    }
    return this.dataSource.transaction(execute);
  }

  /**
   * Extiende la vigencia de la suscripción activa en `validityDays` desde la fecha de fin actual
   * (o hoy si no tenía) y registra una operación simulada `renewal` en la misma transacción (SPEC-302).
   * SPEC-305: el pago simulado se resuelve después de comprobar que el plan es renovable; si la tarjeta
   * se rechaza o no es de prueba, la excepción revierte la transacción y la vigencia no cambia.
   */
  async renewSubscription(
    organizationId: string,
    payment?: PaymentInput,
    transactionalManager?: EntityManager,
  ): Promise<Subscription> {
    const execute = async (manager: EntityManager): Promise<Subscription> => {
      const activeSub = await manager.findOne(Subscription, {
        where: { organizationId, status: SubscriptionStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });

      if (!activeSub) {
        throw new UnprocessableEntityException({
          code: 'NO_ACTIVE_SUBSCRIPTION',
          message: 'La organización no tiene una suscripción activa vigente para renovar.',
        });
      }

      const todayUtcStr = todayUtcDate();
      const currentEndStr = activeSub.expiresAt
        ? todayUtcDate(activeSub.expiresAt)
        : null;

      if (currentEndStr && currentEndStr <= todayUtcStr) {
        throw new UnprocessableEntityException({
          code: 'NO_ACTIVE_SUBSCRIPTION',
          message: 'La suscripción actual ya ha vencido; activa nuevamente un plan.',
        });
      }

      const plan =
        activeSub.plan ?? (await manager.findOne(Plan, { where: { id: activeSub.planId } }));
      if (!plan || !plan.validityDays || plan.validityDays <= 0) {
        throw new UnprocessableEntityException({
          code: 'PLAN_NOT_RENEWABLE',
          message: 'El plan actual no tiene vencimiento y no es renovable.',
        });
      }

      // SPEC-305: 400 / 422 TEST_CARD_REQUIRED / 402 PAYMENT_DECLINED antes de escribir nada
      const cardLast4 = resolveSimulatedPayment(plan, payment, new Date());

      const todayUtcMs = Date.parse(`${todayUtcStr}T00:00:00.000Z`);
      const currentEndMs = currentEndStr
        ? Date.parse(`${currentEndStr}T00:00:00.000Z`)
        : todayUtcMs;
      const baseMs = currentEndStr ? currentEndMs : todayUtcMs;

      activeSub.expiresAt = new Date(baseMs + plan.validityDays * 86400000);
      activeSub.plan = plan;

      const saved = await manager.save(activeSub);
      saved.plan = plan;

      const amountUsd = priceUsd(plan);
      await this.recordOperation(
        manager,
        saved,
        BillingOperationType.RENEWAL,
        amountUsd,
        cardLast4,
      );

      return saved;
    };

    if (transactionalManager) {
      return execute(transactionalManager);
    }
    return this.dataSource.transaction(execute);
  }

  // ── Gestión Centralizada de Cuota y Fallback de Estado ────────────────────

  /**
   * Devuelve el límite de almacenamiento en bytes para una organización.
   * Usado internamente por FilesModule.uploadMultipartFile() antes de aceptar subidas.
   *
   * Fallback de estado: Si la organización no tiene suscripción activa o su plan venció,
   * retorna BigInt(0), bloqueando inmediatamente nuevas cargas por cuota excedida.
   */
  async getStorageLimitBytes(organizationId: string): Promise<bigint> {
    const activeSub = await this.getActiveSubscription(organizationId);
    if (!activeSub || !activeSub.plan) {
      return BigInt(0);
    }
    return BigInt(activeSub.plan.storageLimitBytes);
  }

  /**
   * Retorna un resumen unificado para el Dashboard y módulos externos.
   * Maneja explícitamente el fallback de organizaciones sin suscripción persistida.
   */
  async getSubscriptionSummary(organizationId: string) {
    const activeSub = await this.getActiveSubscription(organizationId);
    if (!activeSub || !activeSub.plan) {
      return {
        status: 'inactive',
        simulated: false,
        expiresAt: null,
        storageLimitBytes: 0,
        plan: null,
      };
    }

    return {
      status: activeSub.status,
      simulated: activeSub.simulated,
      expiresAt: activeSub.expiresAt ? activeSub.expiresAt.toISOString() : null,
      storageLimitBytes: Number(activeSub.plan.storageLimitBytes),
      plan: {
        id: activeSub.plan.id,
        name: activeSub.plan.name,
        description: activeSub.plan.description || '',
        priceMonthly: priceUsd(activeSub.plan),
        storageLimitBytes: Number(activeSub.plan.storageLimitBytes),
        userLimit: activeSub.plan.maxMembers,
        validityDays: activeSub.plan.validityDays ?? null,
      },
    };
  }

  // ── SPEC-504: edición del catálogo ────────────────────────────────────────

  /**
   * Bloquea la fila del plan (SELECT ... FOR UPDATE) dentro de la transacción del llamador.
   * El plan Demo no es editable: se rechaza antes de cualquier escritura.
   */
  async lockPlanForUpdate(manager: EntityManager, planId: string): Promise<Plan> {
    const plan = await manager.findOne(Plan, {
      where: { id: planId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!plan) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'El plan solicitado no existe' });
    }
    if (plan.name === 'Demo') {
      throw new UnprocessableEntityException({ code: 'PLAN_NOT_EDITABLE', message: 'El plan Demo no se puede editar' });
    }
    return plan;
  }

  /**
   * Aplica solo los campos definidos en `changes` y guarda el plan.
   * Unidades: `priceCents` en centavos (el transformer lo convierte a USD); `storageLimitBytes` en bytes, nunca en GB.
   */
  async applyPlanChanges(manager: EntityManager, plan: Plan, changes: PlanChanges): Promise<Plan> {
    if (changes.priceCents !== undefined) {
      plan.priceCents = changes.priceCents;
    }
    if (changes.storageLimitBytes !== undefined) {
      plan.storageLimitBytes = changes.storageLimitBytes;
    }
    if (changes.maxMembers !== undefined) {
      plan.maxMembers = changes.maxMembers;
    }
    if (changes.description !== undefined) {
      plan.description = changes.description;
    }
    return manager.save(plan);
  }
}

// ── SPEC-504: edición del catálogo ──

/** Cambios parciales de un plan (SPEC-504). Solo se aplican los campos presentes. */
export interface PlanChanges {
  priceCents?: number;
  storageLimitBytes?: string;
  maxMembers?: number;
  description?: string;
}
