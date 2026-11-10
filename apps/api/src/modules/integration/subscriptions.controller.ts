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
import { AuditAction, AuditResource, AuditResult } from '../audit/audit.types';
import { SubscriptionCoordinator } from './subscription.coordinator';
import { BillingService } from '../billing/billing.service';
import {
  ActivateSubscriptionDto,
  RenewSubscriptionDto,
  SubscriptionActivationResponse,
} from '../billing/billing.dto';
import { PaymentDeclinedException } from '../billing/simulated-payment';
import { Subscription } from '../billing/entities/subscription.entity';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';
import { RolesGuard } from '../iam/guards/roles.guard';
import { Roles } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { AccountNotices } from '../iam/services/account-notices.service';

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
    private readonly notices: AccountNotices,
  ) {}

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.TENANT_ADMIN)
  @Post('activate')
  async activate(
    @Request() req: { user: AuthUser },
    @Body() body: ActivateSubscriptionDto,
  ): Promise<SubscriptionActivationResponse> {
    const orgId = req.user.organizationId;
    const subscription = await this.withDeclineAudit(req.user, () =>
      this.subscriptionCoordinator.activateSubscription(orgId, body.planId, body.payment),
    );

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
    @Body() body?: RenewSubscriptionDto,
  ): Promise<SubscriptionActivationResponse> {
    const orgId = req.user.organizationId;
    const subscription = await this.withDeclineAudit(req.user, () =>
      this.billingService.renewSubscription(orgId, body?.payment),
    );
    await this.notices.planChanged(orgId);

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

  /**
   * SPEC-305: si la tarjeta de prueba se rechaza (402), registra PAYMENT_DECLINED con resultado failure y
   * relanza el error. La transacción ya se revirtió. El evento no lleva datos de la tarjeta.
   */
  private async withDeclineAudit(
    user: AuthUser,
    operation: () => Promise<Subscription>,
  ): Promise<Subscription> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof PaymentDeclinedException) {
        await this.audit.logEvent({
          organizationId: user.organizationId,
          actorId: user.userId,
          action: AuditAction.PAYMENT_DECLINED,
          resourceType: AuditResource.SUBSCRIPTION,
          result: AuditResult.FAILURE,
        });
      }
      throw error;
    }
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
