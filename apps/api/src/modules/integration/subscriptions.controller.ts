import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  UseFilters,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SubscriptionCoordinator } from './subscription.coordinator';
import {
  ActivateSubscriptionDto,
  SubscriptionActivationResponse,
} from '../billing/billing.dto';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';

/**
 * SubscriptionsController — Coordinación de suscripciones en Integración
 *
 * Expone POST /api/subscriptions/activate para el frontend y clientes API.
 * Aplica ApiExceptionFilter para garantizar el formato canónico:
 * { code, message, requestId }
 */
@Controller('subscriptions')
@UseFilters(ApiExceptionFilter)
export class SubscriptionsController {
  constructor(private readonly subscriptionCoordinator: SubscriptionCoordinator) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('activate')
  async activate(
    @Request() req: any,
    @Body() body: ActivateSubscriptionDto,
  ): Promise<SubscriptionActivationResponse> {
    const orgId = req.user.organizationId;
    const subscription = await this.subscriptionCoordinator.activateSubscription(orgId, body.planId);

    return {
      subscriptionId: subscription.id,
      status: 'active',
      simulated: true,
      startDate: subscription.createdAt.toISOString(),
      endDate: subscription.expiresAt ? subscription.expiresAt.toISOString() : null,
    };
  }
}
