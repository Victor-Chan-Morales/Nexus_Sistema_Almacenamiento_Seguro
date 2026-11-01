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
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
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
    private readonly audit: AuditService,
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

    // SPEC-405: PLAN_ACTIVATED tras éxito; también en la reactivación idempotente
    void this.audit.logEvent({
      organizationId: orgId,
      actorId: req.user.userId,
      action: AuditAction.PLAN_ACTIVATED,
      resourceType: AuditResource.SUBSCRIPTION,
      resourceId: subscription.id,
    }).catch(() => {});

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

    // SPEC-405: PLAN_RENEWED tras éxito
    void this.audit.logEvent({
      organizationId: orgId,
      actorId: req.user.userId,
      action: AuditAction.PLAN_RENEWED,
      resourceType: AuditResource.SUBSCRIPTION,
      resourceId: subscription.id,
    }).catch(() => {});

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
