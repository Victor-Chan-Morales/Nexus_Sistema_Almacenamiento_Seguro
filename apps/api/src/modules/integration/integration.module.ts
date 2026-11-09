import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { FilesModule } from '../files/files.module';
import { IamModule } from '../iam/iam.module';
import { InstallationRequest } from './entities/installation-request.entity';
import { InstallationRequestsController } from './installation-requests.controller';
import { InstallationRequestsService } from './installation-requests.service';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformController } from './platform.controller';
import { StoragePolicyController } from './storage-policy.controller';
import { StoragePolicyService } from './storage-policy.service';
import { SubscriptionCoordinator } from './subscription.coordinator';
import { SubscriptionsController } from './subscriptions.controller';

/**
 * IntegrationModule — Capa de integración entre dominios en el Monolito Modular
 *
 * Conecta Billing, Files e IAM mediante coordinadores (SubscriptionCoordinator, StoragePolicyService)
 * sin generar dependencias circulares entre los dominios y asegurando la validación atómica de contratos.
 * También aloja las consultas de plataforma del Super Admin (PlatformController, SPEC-501).
 */
@Module({
  imports: [
    BillingModule,
    FilesModule,
    IamModule, // SPEC-803: OrganizationRepository (modelo de despliegue) y el guard JWT
    TypeOrmModule.forFeature([InstallationRequest]), // SPEC-803: admin.installation_request
  ],
  controllers: [
    SubscriptionsController,
    PlatformController,
    StoragePolicyController,
    InstallationRequestsController,
  ],
  providers: [
    SubscriptionCoordinator,
    PlatformAdminService,
    StoragePolicyService,
    InstallationRequestsService,
  ],
  exports: [SubscriptionCoordinator, StoragePolicyService],
})
export class IntegrationModule {}
