import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { FilesModule } from '../files/files.module';
import { SubscriptionCoordinator } from './subscription.coordinator';
import { SubscriptionsController } from './subscriptions.controller';

/**
 * IntegrationModule — Capa de integración entre dominios en el Monolito Modular
 *
 * Conecta Billing y Files mediante SubscriptionCoordinator sin generar dependencias
 * circulares entre los dominios y asegurando la validación atómica de contratos.
 */
@Module({
  imports: [
    BillingModule,
    FilesModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionCoordinator],
  exports: [SubscriptionCoordinator],
})
export class IntegrationModule {}
