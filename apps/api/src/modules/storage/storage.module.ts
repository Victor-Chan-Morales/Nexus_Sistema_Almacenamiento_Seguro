import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

/**
 * Módulo STORAGE
 * Responsable: Miguel
 *
 * Encapsula el contrato de almacenamiento de objetos (MinIO/S3).
 * FilesModule lo importa e inyecta StorageService directamente
 * en lugar de hacer llamadas HTTP a un servicio externo.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    StorageService,
    // Proveedor de cliente MinIO configurado desde variables de entorno
    {
      provide: 'MINIO_CLIENT',
      useFactory: (config: ConfigService) => {
        // Importación dinámica para evitar errores si MinIO no está disponible
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Minio = require('minio');
        return new Minio.Client({
          endPoint: config.get('MINIO_ENDPOINT', 'localhost'),
          port: parseInt(String(config.get('MINIO_PORT', 9000)), 10),
          useSSL: config.get('MINIO_USE_SSL', 'false') === 'true',
          accessKey: config.get('MINIO_ROOT_USER', 'nexus_local'),
          secretKey: config.get('MINIO_ROOT_PASSWORD', 'local_only_change_me_please'),
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
