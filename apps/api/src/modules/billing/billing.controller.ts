import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BillingService } from './billing.service';

/**
 * BillingController
 *
 * GET  /api/plans                   → Lista catálogo de planes (público / auth)
 * POST /api/subscriptions/activate  → Activar suscripción simulada (requiere JWT)
 * GET  /api/billing/subscription    → Suscripción activa de la organización (requiere JWT)
 */
@Controller()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('plans')
  async listPlans() {
    const plans = await this.billingService.listPlans();
    const items = plans.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || 'Plan de almacenamiento seguro Nexus',
      priceMonthly: (p.priceCents || 0) / 100,
      storageLimitBytes: Number(p.storageLimitBytes),
      userLimit: p.maxMembers,
      validityDays: p.validityDays || 30,
    }));
    return { items };
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('subscriptions/activate')
  async activate(
    @Request() req: any,
    @Body() body: { planId: string },
  ) {
    const orgId = req.user.organizationId;
    const subscription = await this.billingService.subscribe(orgId, body.planId);
    return {
      subscriptionId: subscription.id,
      status: 'active' as const,
      simulated: true as const,
      startDate: subscription.createdAt.toISOString(),
      endDate: subscription.expiresAt ? subscription.expiresAt.toISOString() : null,
    };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('billing/subscription')
  async getSubscription(@Request() req: any) {
    return this.billingService.getSubscription(req.user.organizationId);
  }
}
