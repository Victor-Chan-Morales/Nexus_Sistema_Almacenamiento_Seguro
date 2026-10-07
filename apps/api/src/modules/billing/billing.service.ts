import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from './entities/plan.entity';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';

/**
 * BillingService — lógica de planes y suscripciones.
 *
 * Es consumido directamente por FilesModule para verificar la cuota
 * de almacenamiento de una organización — sin llamadas HTTP.
 */
@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,

    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
  ) {}

  // ── Planes ────────────────────────────────────────────────────────────────

  async listPlans(): Promise<Plan[]> {
    return this.planRepo.findBy({ active: true });
  }

  async findPlanById(planId: string): Promise<Plan> {
    const plan = await this.planRepo.findOneBy({ id: planId });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    return plan;
  }

  // ── Suscripciones ─────────────────────────────────────────────────────────

  async getSubscription(organizationId: string): Promise<Subscription | null> {
    return this.subscriptionRepo.findOne({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  async subscribe(organizationId: string, planId: string): Promise<Subscription> {
    const plan = await this.findPlanById(planId);

    const subscription = this.subscriptionRepo.create({
      organizationId,
      planId: plan.id,
      status: SubscriptionStatus.SIMULATED,
    });

    return this.subscriptionRepo.save(subscription);
  }

  /**
   * Devuelve el límite de almacenamiento en bytes para una organización.
   * Usado internamente por FilesModule sin llamadas HTTP.
   */
  async getStorageLimitBytes(organizationId: string): Promise<bigint> {
    const sub = await this.getSubscription(organizationId);
    if (!sub) return BigInt(1073741824); // 1 GB por defecto
    return BigInt(sub.plan.storageLimitBytes);
  }
}
