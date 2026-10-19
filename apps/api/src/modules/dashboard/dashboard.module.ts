import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { FilesModule } from '../files/files.module';
import { FilesService } from '../files/files.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService, STORAGE_USAGE_SOURCE } from './dashboard.service';

/**
 * Módulo DASHBOARD
 * Responsable de integración: Víctor
 *
 * Agrega plan (Billing), uso confirmado (Files) y organización (IAM) en
 * GET /api/dashboard usando servicios exportados, sin HTTP interno ni acceso
 * directo a las tablas de otros dominios.
 */
@Module({
  imports: [BillingModule, FilesModule],
  controllers: [DashboardController],
  providers: [DashboardService, { provide: STORAGE_USAGE_SOURCE, useExisting: FilesService }],
})
export class DashboardModule {}
