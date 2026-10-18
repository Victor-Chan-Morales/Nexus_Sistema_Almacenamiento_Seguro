import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { Plan } from './entities/plan.entity';
import { Subscription } from './entities/subscription.entity';
import { STORAGE_USAGE_PORT } from './ports/storage-usage.port';
import { ModuleRefStorageUsageAdapter } from './adapters/module-ref-storage-usage.adapter';

/**
 * Módulo BILLING
 * Responsable: Anthony
 *
 * Implementa inversión de dependencias mediante StorageUsagePort para consultar
 * almacenamiento sin acoplamiento directo ni ciclos con FilesModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Plan, Subscription]),
  ],
  controllers: [BillingController],
  providers: [
    BillingService,
    {
      provide: STORAGE_USAGE_PORT,
      useClass: ModuleRefStorageUsageAdapter,
    },
  ],
  exports: [BillingService, STORAGE_USAGE_PORT],
})
export class BillingModule {}
