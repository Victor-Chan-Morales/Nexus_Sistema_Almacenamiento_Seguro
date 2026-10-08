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

/**
 * Módulo IAM (Identity & Access Management)
 * Responsable: Sebastián
 *
 * Gestiona: usuarios, organizaciones, membresías, roles y autenticación JWT.
 * Comunica sus servicios directamente con otros módulos del monolito
 * mediante inyección de dependencias — SIN llamadas HTTP entre servicios.
 */
@Module({
  imports: [
    // Entidades de este módulo registradas en TypeORM
    TypeOrmModule.forFeature([User, Organization, Membership]),

    // Autenticación con Passport
    PassportModule.register({ defaultStrategy: 'jwt' }),

    // JWT configurado desde variables de entorno
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
  ],
  controllers: [IamController],
  providers: [IamService, JwtStrategy],
  // Exportamos IamService para que FilesModule y BillingModule lo usen directamente
  exports: [IamService, JwtModule, PassportModule],
})
export class IamModule {}
