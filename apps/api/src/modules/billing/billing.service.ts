import {
  Injectable,
  NotFoundException,
  ConflictException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Plan, StorageLocation } from './entities/plan.entity';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';

/**
 * BillingService — gestión centralizada de planes, cuotas y suscripciones simuladas.
 *
 * Consumido internamente por:
 * - FilesModule: consulta cuotas in-process (`getStorageLimitBytes`)
 * - IamModule: provisiona la suscripción Demo durante el registro atómico (`provisionInitialSubscription`)
 * - Dashboard: consulta resumen de plan y límite
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
    private readonly moduleRef: ModuleRef,
  ) {}

  async onModuleInit() {
    await this.seedDefaultPlans();
  }

  // ── Catálogo y Seeding ───────────────────────────────────────────────────

  /**
   * Asegura la persistencia repetible e idempotente del catálogo aprobado.
   * Si ocurre un error, se registra de forma visible y no se oculta.
   */
  async seedDefaultPlans(): Promise<void> {
    try {
      const defaultCatalog: Partial<Plan>[] = [
        {
          name: 'Plan Demo',
          description: 'Prueba el espacio de trabajo de Nexus con capacidad para una organización pequeña.',
          priceCents: 0,
          storageLimitBytes: '5368709120', // 5 GB
          maxMembers: 5,
          validityDays: null, // Sin vencimiento mientras sea gratuito
          active: true,
          storageLocation: StorageLocation.CLOUD,
        },
        {
          name: 'Plan Team',
          description: 'Almacenamiento seguro para equipos pequeños que comparten archivos de trabajo.',
          priceCents: 1999, // US$ 19.99
          storageLimitBytes: '107374182400', // 100 GB
          maxMembers: 10,
          validityDays: 30, // Mensual
          active: true,
          storageLocation: StorageLocation.CLOUD,
        },
        {
          name: 'Plan Business',
          description: 'Más capacidad y espacio para organizaciones en crecimiento.',
          priceCents: 5999, // US$ 59.99
          storageLimitBytes: '536870912000', // 500 GB
          maxMembers: 30,
          validityDays: 30, // Mensual
          active: true,
          storageLocation: StorageLocation.CLOUD,
        },
        {
          name: 'Plan Enterprise',
          description: 'Capacidad ampliada para organizaciones con mayor volumen.',
          priceCents: 14999, // US$ 149.99
          storageLimitBytes: '2147483648000', // 2 TB
          maxMembers: 100,
          validityDays: 30, // Mensual
          active: true,
          storageLocation: StorageLocation.CLOUD,
        },
      ];

      for (const item of defaultCatalog) {
        const existing = await this.planRepo.findOneBy({ name: item.name });
        if (!existing) {
          const created = this.planRepo.create(item);
          await this.planRepo.save(created);
        } else {
          // Asegurar que las reglas vigentes (ej. Demo sin vencimiento) se actualicen si difieren
          let modified = false;
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
          if (modified) {
            await this.planRepo.save(existing);
          }
        }
      }

      this.logger.log('Catálogo de planes verificado y sincronizado correctamente.');
    } catch (error: any) {
      this.logger.error(`Fallo crítico al sembrar el catálogo de planes: ${error?.message}`, error?.stack);
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
    const demo = await this.planRepo.findOneBy({ name: 'Plan Demo' });
    if (!demo) {
      throw new NotFoundException('El Plan Demo no se encuentra registrado en el catálogo');
    }
    return demo;
  }

  // ── Provisión Inicial de Suscripción (Hook de Registro) ──────────────────

  /**
   * Provisiona de forma atómica la suscripción inicial (Plan Demo) para una organización.
   * Acepta un EntityManager opcional para ejecutarse dentro de la transacción de registro de IAM.
   */
  async provisionInitialSubscription(
    organizationId: string,
    transactionalManager?: EntityManager,
  ): Promise<Subscription> {
    const execute = async (manager: EntityManager): Promise<Subscription> => {
      const demoPlan = await manager.findOne(Plan, { where: { name: 'Plan Demo' } })
        || await this.getDemoPlan();

      // Idempotencia: si ya tiene suscripción activa a Demo, retornarla
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
        simulated: true,
        expiresAt: null, // Demo no tiene vencimiento
      });

      return manager.save(subscription);
    };

    if (transactionalManager) {
      return execute(transactionalManager);
    }
    return this.dataSource.transaction(execute);
  }

  // ── Suscripciones y Cambios de Plan ─────────────────────────────────────

  /**
   * Retorna la suscripción activa evaluando vigencia real.
   * Si ha vencido, actualiza su estado a EXPIRED en base de datos.
   */
  async getActiveSubscription(organizationId: string): Promise<Subscription | null> {
    const sub = await this.subscriptionRepo.findOne({
      where: { organizationId, status: SubscriptionStatus.ACTIVE },
      relations: ['plan'],
      order: { createdAt: 'DESC' },
    });

    if (!sub) return null;

    if (sub.expiresAt && sub.expiresAt.getTime() < Date.now()) {
      sub.status = SubscriptionStatus.EXPIRED;
      await this.subscriptionRepo.save(sub);
      return null;
    }

    return sub;
  }

  /**
   * Retorna el detalle completo de suscripción (incluso si está expirada o cancelada).
   */
  async getSubscription(organizationId: string): Promise<Subscription | null> {
    const sub = await this.subscriptionRepo.findOne({
      where: { organizationId },
      relations: ['plan'],
      order: { createdAt: 'DESC' },
    });

    if (sub && sub.status === SubscriptionStatus.ACTIVE && sub.expiresAt && sub.expiresAt.getTime() < Date.now()) {
      sub.status = SubscriptionStatus.EXPIRED;
      await this.subscriptionRepo.save(sub);
    }

    return sub;
  }

  /**
   * Activa o cambia la suscripción para la organización autenticada de forma atómica.
   * Reglas validadas:
   * 1. Idempotencia: Si ya está activo el mismo plan, no cancela ni recrea; retorna la suscripción actual.
   * 2. Downgrade validado: Si se solicita un plan menor, valida contra el uso confirmado de Files.
   * 3. Transaccionalidad: Cancela la anterior y crea la nueva atómicamente.
   * 4. Expiración precisa: Demo = null; Planes de pago = 30 días.
   */
  async subscribe(organizationId: string, planId: string): Promise<Subscription> {
    const targetPlan = await this.findPlanById(planId);

    // 1. Obtener suscripción activa actual
    const currentActive = await this.getActiveSubscription(organizationId);

    // Idempotencia: activación repetida del mismo plan activo
    if (currentActive && currentActive.planId === targetPlan.id) {
      return currentActive;
    }

    // 2. Validación de downgrade (plan con menor capacidad que el almacenamiento actual)
    const currentStorageUsed = await this.getConfirmedStorageUsedBytes(organizationId);
    const targetStorageLimit = BigInt(targetPlan.storageLimitBytes);

    if (currentStorageUsed > targetStorageLimit) {
      throw new ConflictException({
        code: 'ERROR_DOWNGRADE_STORAGE_EXCEEDED',
        message: `El almacenamiento utilizado (${currentStorageUsed} bytes) supera la capacidad del plan seleccionado (${targetStorageLimit} bytes). Elimine o descargue archivos antes de cambiar a un plan menor.`,
      });
    }

    // 3. Ejecución transaccional atómica
    return this.dataSource.transaction(async (manager: EntityManager) => {
      // Cancelar suscripción activa anterior si existe
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
    });
  }

  // ── Gestión Centralizada de Cuota (In-Process) ───────────────────────────

  /**
   * Devuelve el límite de almacenamiento en bytes para una organización.
   * Llamado directamente en memoria por FilesModule.uploadFile() sin HTTP.
   *
   * Si la suscripción expiró o no existe, retorna 0n para bloquear nuevas cargas.
   */
  async getStorageLimitBytes(organizationId: string): Promise<bigint> {
    const activeSub = await this.getActiveSubscription(organizationId);
    if (!activeSub || !activeSub.plan) {
      return BigInt(0);
    }
    return BigInt(activeSub.plan.storageLimitBytes);
  }

  /**
   * Consulta el uso actual confirmado de almacenamiento invocando FilesService in-process,
   * sin dependencias estáticas circulares de módulos.
   */
  public async getConfirmedStorageUsedBytes(organizationId: string): Promise<bigint> {
    try {
      const filesService = this.moduleRef.get<any>('FilesService', { strict: false });
      if (filesService && typeof filesService.getUsedStorageBytes === 'function') {
        return await filesService.getUsedStorageBytes(organizationId);
      }
    } catch {
      // Si FilesService no está disponible o inicializado
    }
    return BigInt(0);
  }
}
