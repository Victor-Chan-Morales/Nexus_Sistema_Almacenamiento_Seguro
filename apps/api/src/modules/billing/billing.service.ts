import {
  Injectable,
  NotFoundException,
  ConflictException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Plan, StorageLocation } from './entities/plan.entity';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';

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
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,

    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,

    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.seedDefaultPlans();
  }

  // ── Catálogo y Seeding (Fail-Fast e Idempotente) ──────────────────────────

  /**
   * Asegura la persistencia repetible del catálogo aprobado con valores decimales exactos.
   * Si ocurre un error de base de datos, falla de forma inmediata (fail-fast)
   * registrando la causa en el logger para no ocultar inconsistencias.
   */
  async seedDefaultPlans(): Promise<void> {
    try {
      const defaultCatalog: Partial<Plan>[] = [
        {
          name: 'Demo',
          description: 'Prueba el espacio de trabajo de Nexus con capacidad para una organización pequeña.',
          priceCents: 0,
          storageLimitBytes: '5000000000', // 5 GB decimales
          maxMembers: 5,
          validityDays: null, // Vencimiento indefinido mientras sea gratuito
          active: true,
          storageLocation: StorageLocation.CLOUD,
        },
        {
          name: 'Team',
          description: 'Almacenamiento seguro para equipos pequeños que comparten archivos de trabajo.',
          priceCents: 1999, // US$ 19.99
          storageLimitBytes: '100000000000', // 100 GB decimales
          maxMembers: 10,
          validityDays: 30, // 30 días de vigencia
          active: true,
          storageLocation: StorageLocation.CLOUD,
        },
        {
          name: 'Business',
          description: 'Más capacidad y espacio para organizaciones en crecimiento.',
          priceCents: 5999, // US$ 59.99
          storageLimitBytes: '500000000000', // 500 GB decimales
          maxMembers: 30,
          validityDays: 30, // 30 días de vigencia
          active: true,
          storageLocation: StorageLocation.CLOUD,
        },
        {
          name: 'Enterprise',
          description: 'Capacidad ampliada para organizaciones con mayor volumen.',
          priceCents: 14999, // US$ 149.99
          storageLimitBytes: '2000000000000', // 2 TB decimales
          maxMembers: 100,
          validityDays: 30, // 30 días de vigencia
          active: true,
          storageLocation: StorageLocation.CLOUD,
        },
      ];

      // Mapeo de nombres legados para normalización
      const legacyNameMap: Record<string, string> = {
        Demo: 'Plan Demo',
        Team: 'Plan Team',
        Business: 'Plan Business',
        Enterprise: 'Plan Enterprise',
      };

      for (const item of defaultCatalog) {
        // Buscar por nombre canónico o por nombre legado
        const legacyName = legacyNameMap[item.name!];
        let existing = await this.planRepo.findOneBy({ name: item.name });
        if (!existing && legacyName) {
          existing = await this.planRepo.findOneBy({ name: legacyName });
          if (existing) {
            existing.name = item.name!;
          }
        }

        if (!existing) {
          const created = this.planRepo.create(item);
          await this.planRepo.save(created);
        } else {
          let modified = false;
          if (existing.name !== item.name) {
            existing.name = item.name!;
            modified = true;
          }
          if (existing.validityDays !== item.validityDays) {
            existing.validityDays = item.validityDays ?? null;
            modified = true;
          }
          if (existing.description !== item.description) {
            existing.description = item.description;
            modified = true;
          }
          if (existing.storageLimitBytes !== item.storageLimitBytes) {
            existing.storageLimitBytes = item.storageLimitBytes!;
            modified = true;
          }
          if (existing.maxMembers !== item.maxMembers) {
            existing.maxMembers = item.maxMembers!;
            modified = true;
          }
          if (existing.priceCents !== item.priceCents) {
            existing.priceCents = item.priceCents!;
            modified = true;
          }
          if (modified) {
            await this.planRepo.save(existing);
          }
        }
      }

      this.logger.log('Catálogo de planes validado y sincronizado con éxito (valores decimales).');
    } catch (error: any) {
      this.logger.error(
        `Fallo crítico de inicialización: no se pudo sembrar el catálogo de planes: ${error?.message}`,
        error?.stack,
      );
      // Fail-fast: interrumpir el arranque si el catálogo obligatorio no se puede inicializar
      throw error;
    }
  }

  async listPlans(): Promise<Plan[]> {
    return this.planRepo.find({
      where: { active: true },
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
    const demo = await this.planRepo.findOneBy({ name: 'Demo' })
      || await this.planRepo.findOneBy({ name: 'Plan Demo' });
    if (!demo) {
      throw new NotFoundException('El Plan Demo no se encuentra registrado en el catálogo');
    }
    return demo;
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
      const demoPlan = await manager.findOne(Plan, { where: { name: 'Demo' } })
        || await manager.findOne(Plan, { where: { name: 'Plan Demo' } })
        || await this.getDemoPlan();

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
        simulated: true, // Sin cobro real
        expiresAt: null, // Demo sin vencimiento
      });

      const saved = await manager.save(subscription);
      saved.plan = demoPlan;
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

    if (sub.expiresAt && sub.expiresAt.getTime() < Date.now()) {
      sub.status = SubscriptionStatus.EXPIRED;
      await repo.save(sub);
      return null;
    }

    return sub;
  }

  /**
   * Retorna únicamente la suscripción vigente (o null) para la organización,
   * omitiendo el historial de suscripciones canceladas o vencidas (CONTRACTS.md v0.3).
   */
  async getSubscription(organizationId: string): Promise<Subscription | null> {
    return this.getActiveSubscription(organizationId);
  }

  /**
   * Persiste transaccionalmente el cambio o activación de suscripción.
   * Cancela la suscripción activa previa y guarda la nueva de forma atómica.
   * Captura específicamente la colisión del índice único parcial (uq_active_org_subscription, código 23505)
   * y lo devuelve como ConflictException controlado.
   */
  async persistSubscription(
    organizationId: string,
    targetPlan: Plan,
    transactionalManager?: EntityManager,
  ): Promise<Subscription> {
    const execute = async (manager: EntityManager): Promise<Subscription> => {
      try {
        // Bloqueo pesimista de escritura para evitar carreras concurrentes en la misma organización
        const currentActive = await manager.findOne(Subscription, {
          where: { organizationId, status: SubscriptionStatus.ACTIVE },
          lock: { mode: 'pessimistic_write' },
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
          simulated: true, // Sin pasarelas de pago ni tarjetas reales
          expiresAt,
        });

        const saved = await manager.save(newSubscription);
        saved.plan = targetPlan;
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
   * Activa o cambia la suscripción para la organización.
   * Sobrecarga directa que delega en persistSubscription.
   */
  async subscribe(
    organizationId: string,
    planId: string,
    transactionalManager?: EntityManager,
  ): Promise<Subscription> {
    const targetPlan = await this.findPlanById(planId);
    return this.persistSubscription(organizationId, targetPlan, transactionalManager);
  }

  // ── Gestión Centralizada de Cuota y Fallback de Estado ────────────────────

  /**
   * Devuelve el límite de almacenamiento en bytes para una organización.
   * Usado internamente por FilesModule.uploadFile() antes de aceptar subidas.
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
        priceMonthly: (activeSub.plan.priceCents || 0) / 100,
        storageLimitBytes: Number(activeSub.plan.storageLimitBytes),
        userLimit: activeSub.plan.maxMembers,
        validityDays: activeSub.plan.validityDays ?? null,
      },
    };
  }
}
