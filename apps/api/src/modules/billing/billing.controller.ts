import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
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
    const items = await this.billingService.listPlans();
    return { items };
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('subscriptions/activate')
  async activate(
    @Request() req,
    @Body() body: { planId: string },
  ) {
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
  getSubscription(@Request() req) {
    return this.billingService.getSubscription(req.user.organizationId);
  }
}
