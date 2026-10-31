import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  UseFilters,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SubscriptionCoordinator } from './subscription.coordinator';
import { BillingService } from '../billing/billing.service';
import {
  ActivateSubscriptionDto,
  SubscriptionActivationResponse,
} from '../billing/billing.dto';
import { Subscription } from '../billing/entities/subscription.entity';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';
import { RolesGuard } from '../iam/guards/roles.guard';
import { Roles } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { AuthUser } from '../iam/interfaces/auth-user.interface';

/**
 * SubscriptionsController — Coordinación de suscripciones en Integración
 *
 * Expone POST /api/subscriptions/activate y POST /api/subscriptions/renew
 * para administradores de organización (tenant_admin).
 * Aplica ApiExceptionFilter para garantizar el formato canónico:
 * { code, message, requestId }
 */
@Controller('subscriptions')
@UseFilters(ApiExceptionFilter)
export class SubscriptionsController {
  constructor(
    private readonly subscriptionCoordinator: SubscriptionCoordinator,
    private readonly billingService: BillingService,
  ) {}

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.TENANT_ADMIN)
  @Post('activate')
  async activate(
    @Request() req: { user: AuthUser },
    @Body() body: ActivateSubscriptionDto,
  ): Promise<SubscriptionActivationResponse> {
    const orgId = req.user.organizationId;
    const subscription = await this.subscriptionCoordinator.activateSubscription(orgId, body.planId);
    return this.toActivationResponse(subscription);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.TENANT_ADMIN)
  @Post('renew')
  @HttpCode(HttpStatus.OK)
  async renew(
    @Request() req: { user: AuthUser },
  ): Promise<SubscriptionActivationResponse> {
    const orgId = req.user.organizationId;
    const subscription = await this.billingService.renewSubscription(orgId);
    return this.toActivationResponse(subscription);
  }

  private toActivationResponse(subscription: Subscription): SubscriptionActivationResponse {
    return {
      subscriptionId: subscription.id,
      status: 'active',
      simulated: true,
      startDate: (subscription.startDate ?? subscription.createdAt).toISOString(),
      endDate: subscription.expiresAt ? subscription.expiresAt.toISOString() : null,
    };
  }
}
