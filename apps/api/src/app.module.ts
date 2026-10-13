import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

// Módulos de dominio — cada uno es independiente dentro del mismo proceso
import { IamModule } from './modules/iam/iam.module';
import { BillingModule } from './modules/billing/billing.module';
import { FilesModule } from './modules/files/files.module';
import { StorageModule } from './modules/storage/storage.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    // ── Configuración global ────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true, // Disponible en todos los módulos sin reimportar
      envFilePath: '../../.env', // Apunta al .env raíz del monorepo
    }),

    // ── Base de datos PostgreSQL ─────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('POSTGRES_HOST', 'localhost'),
        port: config.get<number>('POSTGRES_PORT', 5432),
        username: config.get('POSTGRES_USER', 'nexus_dev'),
        password: config.get('POSTGRES_PASSWORD', 'local_only_change_me'),
        database: config.get('POSTGRES_DB', 'nexus_dev'),
        // En desarrollo carga entidades automáticamente; en producción usar migraciones
        autoLoadEntities: true,
        synchronize: config.get('NODE_ENV') !== 'production',
        logging: config.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),

    // ── Módulos de dominio ───────────────────────────────────────────────────
    IamModule,       // Identidad: usuarios, organizaciones, roles, sesiones
    BillingModule,   // Facturación: planes, suscripciones (simuladas)
    FilesModule,     // Archivos: carpetas, metadatos, versiones, cuotas
    StorageModule,   // Almacenamiento: contrato con SeaweedFS (S3)
    HealthModule,    // Salud: endpoint /api/health para verificar el sistema
  ],
})
export class AppModule {}
