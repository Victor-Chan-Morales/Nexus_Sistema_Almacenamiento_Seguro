import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BillingService } from './billing.service';
import {
  ActivateSubscriptionDto,
  PlanCatalogResponse,
  SubscriptionActivationResponse,
  SubscriptionDetailResponse,
} from './billing.dto';

/**
 * BillingController
 *
 * GET  /api/plans                   → Lista catálogo de planes aprobado (público / auth)
 * POST /api/subscriptions/activate  → Activar / cambiar suscripción simulada (requiere JWT)
 * GET  /api/billing/subscription    → Suscripción activa o detalle de la organización (requiere JWT)
 */
@Controller()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('plans')
  async listPlans(): Promise<PlanCatalogResponse> {
    const plans = await this.billingService.listPlans();
    const items = plans.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || 'Plan de almacenamiento seguro Nexus',
      priceMonthly: (p.priceCents || 0) / 100,
      storageLimitBytes: Number(p.storageLimitBytes),
      userLimit: p.maxMembers,
      validityDays: p.validityDays ?? null,
    }));
    return { items };
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('subscriptions/activate')
  async activate(
    @Request() req: any,
    @Body() body: ActivateSubscriptionDto,
  ): Promise<SubscriptionActivationResponse> {
    const orgId = req.user.organizationId;
    const subscription = await this.billingService.subscribe(orgId, body.planId);
    return {
      subscriptionId: subscription.id,
      status: 'active',
      simulated: true,
      startDate: subscription.createdAt.toISOString(),
      endDate: subscription.expiresAt ? subscription.expiresAt.toISOString() : null,
    };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('billing/subscription')
  async getSubscription(@Request() req: any): Promise<SubscriptionDetailResponse> {
    const sub = await this.billingService.getSubscription(req.user.organizationId);
    if (!sub) {
      throw new NotFoundException('No existe suscripción registrada para la organización');
    }
    return {
      id: sub.id,
      organizationId: sub.organizationId,
      status: sub.status,
      simulated: sub.simulated,
      expiresAt: sub.expiresAt ? sub.expiresAt.toISOString() : null,
      createdAt: sub.createdAt.toISOString(),
      plan: {
        id: sub.plan.id,
        name: sub.plan.name,
        description: sub.plan.description || '',
        priceMonthly: (sub.plan.priceCents || 0) / 100,
        storageLimitBytes: Number(sub.plan.storageLimitBytes),
        userLimit: sub.plan.maxMembers,
        validityDays: sub.plan.validityDays ?? null,
      },
    };
  }
}
