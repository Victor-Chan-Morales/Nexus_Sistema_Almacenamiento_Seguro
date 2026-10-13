import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan, StorageLocation } from './entities/plan.entity';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';

/**
 * BillingService — lógica de planes, cuotas y suscripciones simuladas.
 *
 * Consumido directamente por FilesModule (para verificar cuotas antes de subir archivos)
 * y por el controlador de Billing, todo dentro del monolito modular en el mismo proceso.
 */
@Injectable()
export class BillingService implements OnModuleInit {
  constructor(
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,

    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
  ) {}

  async onModuleInit() {
    await this.seedDefaultPlans();
  }

  /**
   * Asegura la persistencia del catálogo base en desarrollo (Plan Demo de 5GB y 5 usuarios).
   */
  async seedDefaultPlans(): Promise<void> {
    try {
      const count = await this.planRepo.count();
      if (count === 0) {
        const demoPlan = this.planRepo.create({
          name: 'Plan Demo',
          description: 'Plan de prueba con límite de 5GB y hasta 5 usuarios',
          priceCents: 0,
          storageLimitBytes: '5368709120', // 5 GB en bytes
          maxMembers: 5,
          validityDays: 30,
          active: true,
          storageLocation: StorageLocation.CLOUD,
        });

        const teamPlan = this.planRepo.create({
          name: 'Plan Team',
          description: 'Almacenamiento seguro para equipos pequeños (100 GB)',
          priceCents: 1999,
          storageLimitBytes: '107374182400', // 100 GB en bytes
          maxMembers: 10,
          validityDays: 30,
          active: true,
          storageLocation: StorageLocation.CLOUD,
        });

        const businessPlan = this.planRepo.create({
          name: 'Plan Business',
          description: 'Mayor capacidad para organizaciones en crecimiento (500 GB)',
          priceCents: 5999,
          storageLimitBytes: '536870912000', // 500 GB en bytes
          maxMembers: 30,
          validityDays: 30,
          active: true,
          storageLocation: StorageLocation.CLOUD,
        });

        const enterprisePlan = this.planRepo.create({
          name: 'Plan Enterprise',
          description: 'Capacidad ampliada para alto volumen organizacional (2 TB)',
          priceCents: 14999,
          storageLimitBytes: '2147483648000', // 2000 GB en bytes
          maxMembers: 100,
          validityDays: 30,
          active: true,
          storageLocation: StorageLocation.CLOUD,
        });

        await this.planRepo.save([demoPlan, teamPlan, businessPlan, enterprisePlan]);
      }
    } catch {
      // Ignorar si la base de datos aún se está sincronizando o conectando
    }
  }

  // ── Planes ────────────────────────────────────────────────────────────────

  async listPlans(): Promise<Plan[]> {
    return this.planRepo.findBy({ active: true });
  }

  async findPlanById(planId: string): Promise<Plan> {
    const plan = await this.planRepo.findOneBy({ id: planId });
    if (!plan) {
      throw new NotFoundException('El plan solicitado no existe');
    }
    return plan;
  }

  // ── Suscripciones ─────────────────────────────────────────────────────────

  async getSubscription(organizationId: string): Promise<Subscription | null> {
    return this.subscriptionRepo.findOne({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Activa una suscripción simulada para la organización autenticada.
   * Garantiza que la organización tenga solo una suscripción activa a la vez.
   */
  async subscribe(organizationId: string, planId: string): Promise<Subscription> {
    const plan = await this.findPlanById(planId);

    // Cancelar suscripción activa previa para evitar múltiples suscripciones vigentes
    const existingActive = await this.subscriptionRepo.findOne({
      where: { organizationId, status: SubscriptionStatus.SIMULATED },
      order: { createdAt: 'DESC' },
    });

    if (existingActive) {
      existingActive.status = SubscriptionStatus.CANCELLED;
      await this.subscriptionRepo.save(existingActive);
    }

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (plan.validityDays || 30));

    const subscription = this.subscriptionRepo.create({
      organizationId,
      planId: plan.id,
      status: SubscriptionStatus.SIMULATED,
      expiresAt: endDate,
    });

    return this.subscriptionRepo.save(subscription);
  }

  /**
   * Devuelve el límite de almacenamiento en bytes para una organización.
   * Usado internamente por FilesModule sin llamadas HTTP (in-process).
   */
  async getStorageLimitBytes(organizationId: string): Promise<bigint> {
    const sub = await this.getSubscription(organizationId);
    if (!sub || !sub.plan) {
      // Valor por defecto: Cuota del Plan Demo (5 GB = 5,368,709,120 bytes)
      return BigInt('5368709120');
    }
    return BigInt(sub.plan.storageLimitBytes);
  }
}
