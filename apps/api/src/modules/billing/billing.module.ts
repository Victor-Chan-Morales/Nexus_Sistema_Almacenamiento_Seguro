import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { Plan } from './entities/plan.entity';
import { Subscription } from './entities/subscription.entity';
import { IamModule } from '../iam/iam.module';

/**
 * Módulo BILLING
 * Responsable: Anthony
 *
 * Gestiona: planes disponibles y suscripciones (simuladas para el proyecto).
 * Importa IamModule para acceder a IamService y verificar usuarios
 * directamente — sin llamadas HTTP.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Plan, Subscription]),
    IamModule, // Acceso directo a IamService en el mismo proceso
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
