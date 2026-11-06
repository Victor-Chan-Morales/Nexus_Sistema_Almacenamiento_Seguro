import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { FilesModule } from '../files/files.module';
import { IamModule } from '../iam/iam.module';
import { OrganizationClosureService } from './organization-closure.service';
import { OrganizationsController } from './organizations.controller';
import { SubscriptionCoordinator } from './subscription.coordinator';
import { SubscriptionsController } from './subscriptions.controller';

/**
 * IntegrationModule — Capa de integración entre dominios en el Monolito Modular
 *
 * Conecta Billing, Files, IAM y Audit mediante coordinadores de integración
 * sin generar dependencias circulares y asegurando la validación atómica de contratos.
 */
@Module({
  imports: [
    BillingModule,
    FilesModule,
    IamModule,
    AuditModule,
  ],
  controllers: [
    SubscriptionsController,
    OrganizationsController,
  ],
  providers: [
    SubscriptionCoordinator,
    OrganizationClosureService,
  ],
  exports: [
    SubscriptionCoordinator,
    OrganizationClosureService,
  ],
})
export class IntegrationModule {}
