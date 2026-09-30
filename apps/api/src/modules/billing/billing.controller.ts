import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { BillingService } from './billing.service';
import { ActivateSubscriptionDto } from './billing.dto';

@Controller()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('plans')
  async getPlans() {
    const plans = await this.billingService.getCatalog();
    return { items: plans };
  }

  @Post('subscriptions/activate')
  async activateSubscription(
    @Body() body: ActivateSubscriptionDto,
    @Req() request: any 
  ) {
    const organizationId = request.user.organizationId; 
    
    return this.billingService.activate(body.planId, organizationId);
  }
}