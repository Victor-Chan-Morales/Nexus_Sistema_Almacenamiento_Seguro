import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

// Módulos de dominio — cada uno es independiente dentro del mismo proceso
import { IamModule } from './modules/iam/iam.module';
import { BillingModule } from './modules/billing/billing.module';
import { FilesModule } from './modules/files/files.module';
import { StorageModule } from './modules/storage/storage.module';
import { HealthModule } from './modules/health/health.module';
import { IntegrationModule } from './modules/integration/integration.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AuditModule } from './modules/audit/audit.module';

@Module({
  imports: [
    // ── Configuración global ────────────────────────────────────────────────
    // IAM necesita JWT_SECRET (>= 32 caracteres) en este mismo .env; sin él la API no arranca.
    ConfigModule.forRoot({
      isGlobal: true, // Disponible en todos los módulos sin reimportar
      envFilePath: ['.env', '../../.env'], // Apunta al .env raíz del monorepo
    }),

    // ── Base de datos PostgreSQL ─────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('POSTGRES_HOST', 'localhost'),
        port: config.get<number>('POSTGRES_PORT', 5433),
        username: config.get('POSTGRES_USER', 'nexus_dev'),
        password: config.get('POSTGRES_PASSWORD', 'local_only_change_me'),
        database: config.get('POSTGRES_DB', 'nexus_dev'),

        // Carga automáticamente las entidades registradas con TypeOrmModule.forFeature (IAM, etc.)
        autoLoadEntities: true,
        // El esquema (iam, admin, ...) lo crean las migraciones versionadas, NO TypeORM.
        // Con `synchronize: true` TypeORM intentaría alterar tablas ya migradas (columnas, tipos,
        // restricciones) y podría borrar datos. Solo se activa a propósito con DB_SYNCHRONIZE=true.
        synchronize: config.get('DB_SYNCHRONIZE') === 'true',
        logging: config.get('DB_LOGGING') === 'true' ? ['error', 'warn'] : false,
      }),
      inject: [ConfigService],
    }),

    // ── Módulos de dominio ───────────────────────────────────────────────────
    IamModule,         // Identidad: usuarios, organizaciones, roles, sesiones
    BillingModule,     // Facturación: planes, catálogo, suscripciones
    FilesModule,       // Archivos: carpetas, metadatos, versiones, cuotas
    StorageModule,     // Almacenamiento: contrato con SeaweedFS (S3)
    HealthModule,      // Salud: endpoint /api/health para verificar el sistema
    IntegrationModule, // Integración: SubscriptionCoordinator entre Billing y Files
    DashboardModule,   // Integración: GET /api/dashboard (plan + uso + organización)
    AuditModule,       // Auditoría: AuditService.logEvent (global, SPEC-401)
  ],
})
export class AppModule {}
