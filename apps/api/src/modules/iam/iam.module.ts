import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ACCESS_TOKEN_TTL_SECONDS } from './constants';
import { EmailOutbox } from './entities/email-outbox.entity';
import { Membership } from './entities/membership.entity';
import { OneTimeToken } from './entities/one-time-token.entity';
import { Organization } from './entities/organization.entity';
import { IamRole } from './entities/role.entity';
import { Session } from './entities/session.entity';
import { User } from './entities/user.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { IamController } from './iam.controller';
import { IamSettings } from './iam.settings';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import { CryptoOpaqueTokens } from './infrastructure/crypto-opaque-tokens';
import { EmailService } from './infrastructure/email.service';
import { JwtAccessTokenIssuer } from './infrastructure/jwt-access-token-issuer';
import { OutboxCipher } from './infrastructure/outbox-cipher';
import {
  TypeOrmEmailOutboxRepository,
  TypeOrmMembershipRepository,
  TypeOrmOneTimeTokenRepository,
  TypeOrmOrganizationRepository,
  TypeOrmSessionRepository,
  TypeOrmUserRepository,
} from './infrastructure/typeorm-repositories';
import { TypeOrmUnitOfWork } from './infrastructure/typeorm-unit-of-work';
import {
  EmailOutboxRepository,
  MembershipRepository,
  OneTimeTokenRepository,
  OrganizationRepository,
  SessionRepository,
  UserRepository,
} from './ports/repositories';
import { AccessTokenIssuer, OpaqueTokens, PasswordHasher } from './ports/security';
import { UnitOfWork } from './ports/transaction';
import { VerificationMailer } from './ports/verification-mailer';
import { RegistrationHooks } from './registration-hooks';
import { AuthService } from './services/auth.service';
import { EmailOutboxService } from './services/email-outbox.service';
import { EmailVerificationService } from './services/email-verification.service';
import { RegistrationService } from './services/registration.service';
import { SessionService } from './services/session.service';
import { VerificationTokenService } from './services/verification-token.service';
import { JwtStrategy } from './strategies/jwt.strategy';

function resolveJwtSecret(config: ConfigService): string {
  const secret = config.getOrThrow<string>('JWT_SECRET');
  if (secret.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
  if (process.env.NODE_ENV === 'production' && secret.startsWith('dev-only')) {
    throw new Error('JWT_SECRET de desarrollo no permitido en producción');
  }
  return secret;
}

@Module({
  imports: [
    ConfigModule,
    // Registra las entidades del módulo (requiere autoLoadEntities en la configuración TypeORM).
    TypeOrmModule.forFeature([User, Organization, Membership, IamRole, Session, OneTimeToken, EmailOutbox]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: resolveJwtSecret(config),
        signOptions: { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_TTL_SECONDS },
      }),
    }),
  ],
  controllers: [IamController],
  providers: [
    // Casos de uso
    AuthService,
    RegistrationService,
    SessionService,
    EmailVerificationService,
    EmailOutboxService,
    VerificationTokenService,
    OutboxCipher,
    IamSettings,
    RegistrationHooks,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    // Puertos → implementaciones (DIP): cambiar una tecnología es cambiar solo una línea aquí
    { provide: UnitOfWork, useClass: TypeOrmUnitOfWork },
    { provide: UserRepository, useClass: TypeOrmUserRepository },
    { provide: OrganizationRepository, useClass: TypeOrmOrganizationRepository },
    { provide: MembershipRepository, useClass: TypeOrmMembershipRepository },
    { provide: SessionRepository, useClass: TypeOrmSessionRepository },
    { provide: OneTimeTokenRepository, useClass: TypeOrmOneTimeTokenRepository },
    { provide: EmailOutboxRepository, useClass: TypeOrmEmailOutboxRepository },
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: AccessTokenIssuer, useClass: JwtAccessTokenIssuer },
    { provide: OpaqueTokens, useClass: CryptoOpaqueTokens },
    { provide: VerificationMailer, useClass: EmailService },
  ],
  exports: [AuthService, JwtModule, PassportModule, JwtAuthGuard, RolesGuard, RegistrationHooks],
})
export class IamModule {}
