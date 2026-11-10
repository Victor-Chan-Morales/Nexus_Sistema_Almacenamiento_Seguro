import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { FilesModule } from '../files/files.module';
import { IamModule } from '../iam/iam.module';
import { Installation } from './entities/installation.entity';
import { InstallationRequest } from './entities/installation-request.entity';
import { InstallationRequestsController } from './installation-requests.controller';
import { InstallationRequestsService } from './installation-requests.service';
import { OrganizationClosureService } from './organization-closure.service';
import { OrganizationsController } from './organizations.controller';
import { PlatformActionsService } from './platform-actions.service';
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
 * También aloja las consultas de plataforma del Super Admin (PlatformController, SPEC-501) y sus acciones (SPEC-503).
 * Cierre de empresa (SPEC-114): OrganizationClosureService coordina IAM, Billing y Audit.
 */
@Module({
  imports: [
    BillingModule,
    FilesModule,
    IamModule, // SPEC-803: OrganizationRepository (modelo de despliegue) y el guard JWT
    TypeOrmModule.forFeature([InstallationRequest, Installation]), // SPEC-803: admin.installation_request; SPEC-503: admin.installation
    AuditModule, // SPEC-114: ORGANIZATION_CLOSED
  ],
  controllers: [
    SubscriptionsController,
    PlatformController,
    StoragePolicyController,
    InstallationRequestsController,
    OrganizationsController,
  ],
  providers: [
    SubscriptionCoordinator,
    PlatformAdminService,
    PlatformActionsService, // SPEC-503: acciones del Super Admin
    StoragePolicyService,
    InstallationRequestsService,
    OrganizationClosureService,
  ],
  exports: [SubscriptionCoordinator, StoragePolicyService, OrganizationClosureService],
})
export class IntegrationModule {}
