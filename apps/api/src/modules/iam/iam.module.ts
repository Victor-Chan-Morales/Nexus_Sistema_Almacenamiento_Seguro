import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { IamController } from './iam.controller';
import { IamService } from './iam.service';
import { User } from './entities/user.entity';
import { Organization } from './entities/organization.entity';
import { Membership } from './entities/membership.entity';
import { JwtStrategy } from './strategies/jwt.strategy';
import { BillingModule } from '../billing/billing.module';

/**
 * Módulo IAM (Identity & Access Management)
 * Responsable: Sebastián
 *
 * Gestiona: usuarios, organizaciones, membresías, roles y autenticación JWT.
 * Importa BillingModule para la provisión atómica de la suscripción Demo durante el registro.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, Organization, Membership]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'dev-secret-cambia-esto'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d'),
        },
      }),
      inject: [ConfigService],
    }),
    BillingModule, // Inyección directa de BillingService para registro atómico
  ],
  controllers: [IamController],
  providers: [IamService, JwtStrategy],
  exports: [IamService, JwtModule, PassportModule],
})
export class IamModule {}
