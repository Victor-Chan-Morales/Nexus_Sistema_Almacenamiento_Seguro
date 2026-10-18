import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { Plan } from './entities/plan.entity';
import { Subscription } from './entities/subscription.entity';

/**
 * Módulo BILLING
 * Responsable: Anthony
 *
 * Gestiona: catálogo de planes, suscripciones simuladas y cuotas.
 * Exporta BillingService para consumo in-process por IamModule y FilesModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Plan, Subscription]),
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
