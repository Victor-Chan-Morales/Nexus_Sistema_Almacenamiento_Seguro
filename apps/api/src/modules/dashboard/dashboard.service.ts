import { Inject, Injectable } from '@nestjs/common';
import { BillingService } from '../billing/billing.service';

export const STORAGE_USAGE_SOURCE = Symbol('STORAGE_USAGE_SOURCE');

/** Puerto de lectura del uso confirmado en bytes; lo cumple FilesService sin que Dashboard conozca sus tablas. */
export interface StorageUsageSource {
  getUsedStorageBytes(organizationId: string): Promise<bigint>;
}

export interface DashboardPlan {
  id: string;
  name: string;
  storageLimitBytes: number;
  userLimit: number;
  expiresAt: string | null;
  simulated: boolean;
}

export interface DashboardSummary {
  organizationName: string;
  plan: DashboardPlan | null;
  storageUsedBytes: number;
  storageLimitBytes: number;
  recentActivity: never[];
}

/**
 * DashboardService — agrega datos de otros módulos dentro del mismo proceso.
 * El tenant llega siempre desde el JWT validado; nunca desde el navegador.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly billingService: BillingService,
    @Inject(STORAGE_USAGE_SOURCE) private readonly usage: StorageUsageSource,
  ) {}

  async getSummary(organizationName: string, organizationId: string): Promise<DashboardSummary> {
    const [subscription, usedBytes] = await Promise.all([
      this.billingService.getSubscription(organizationId),
      this.usage.getUsedStorageBytes(organizationId),
    ]);

    const plan = subscription?.plan ?? null;
    // Una organización sin suscripción no recibe cuota implícita; el registro debe provisionar Demo.
    const limitBytes = plan
      ? Number(await this.billingService.getStorageLimitBytes(organizationId))
      : 0;

    return {
      organizationName,
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            storageLimitBytes: Number(limitBytes),
            userLimit: plan.maxMembers,
            expiresAt: subscription?.expiresAt ? subscription.expiresAt.toISOString() : null,
            simulated: true,
          }
        : null,
      storageUsedBytes: Number(usedBytes),
      storageLimitBytes: Number(limitBytes),
      recentActivity: [],
    };
  }
}
