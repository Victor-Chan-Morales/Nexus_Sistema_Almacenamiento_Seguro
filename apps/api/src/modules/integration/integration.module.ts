import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { FilesModule } from '../files/files.module';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformController } from './platform.controller';
import { SubscriptionCoordinator } from './subscription.coordinator';
import { SubscriptionsController } from './subscriptions.controller';

/**
 * IntegrationModule — Capa de integración entre dominios en el Monolito Modular
 *
 * Conecta Billing y Files mediante SubscriptionCoordinator sin generar dependencias
 * circulares entre los dominios y asegurando la validación atómica de contratos.
 * También aloja las consultas de plataforma del Super Admin (PlatformController, SPEC-501).
 */
@Module({
  imports: [
    BillingModule,
    FilesModule,
  ],
  controllers: [SubscriptionsController, PlatformController],
  providers: [SubscriptionCoordinator, PlatformAdminService],
  exports: [SubscriptionCoordinator],
})
export class IntegrationModule {}
