import { Injectable, OnModuleInit } from '@nestjs/common';
import { RegistrationHooks } from '../../iam/registration-hooks';
import { BillingService } from '../billing.service';

/**
 * Hook `demo-subscription` que exige el registro de IAM: delega en Billing la provisión del
 * plan Demo y le pasa el EntityManager de la transacción del alta, así que la suscripción se
 * confirma o se revierte junto con el usuario y la organización. La operación es idempotente.
 */
@Injectable()
export class DemoSubscriptionHook implements OnModuleInit {
  constructor(
    private readonly hooks: RegistrationHooks,
    private readonly billing: BillingService,
  ) {}

  onModuleInit(): void {
    this.hooks.register('demo-subscription', async ({ manager, organizationId }) => {
      await this.billing.provisionInitialSubscription(organizationId, manager);
    });
  }
}
