import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { Plan } from './entities/plan.entity';
import { Subscription } from './entities/subscription.entity';
import { IamModule } from '../iam/iam.module';
import { DemoSubscriptionHook } from './registration/demo-subscription.hook';

/**
 * Módulo BILLING
 * Responsable: Anthony
 *
 * Catálogo de planes y persistencia de suscripciones, desacoplado de FilesModule
 * (sin dependencia cíclica ni ModuleRef). Importa IamModule por el guard JWT y por
 * RegistrationHooks: el alta de una organización contrata el plan Demo dentro de la
 * misma transacción del registro (hook demo-subscription).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Plan, Subscription]),
    IamModule, // Guard JWT y RegistrationHooks, en el mismo proceso
  ],
  controllers: [BillingController],
  providers: [BillingService, DemoSubscriptionHook],
  exports: [BillingService],
})
export class BillingModule {}
