import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

/**
 * Módulo STORAGE
 * Responsable: Miguel
 *
 * Encapsula el contrato de almacenamiento de objetos mediante S3.
 * FilesModule lo importa e inyecta StorageService directamente
 * en lugar de hacer llamadas HTTP a un servicio externo.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    StorageService,
    // Cliente compatible con S3 configurado desde variables de entorno
    {
      provide: 'S3_CLIENT',
      useFactory: (config: ConfigService) => {
        const { S3Client } = require('@aws-sdk/client-s3');
        const protocol = config.get('S3_USE_SSL', 'false') === 'true' ? 'https' : 'http';
        const endpoint = `${protocol}://${config.get('S3_ENDPOINT', 'localhost')}:${config.get<number>('S3_PORT', 8333)}`;
        return new S3Client({
          endpoint,
          region: config.get('S3_REGION', 'us-east-1'),
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.get('S3_ACCESS_KEY', 'nexus_local'),
            secretAccessKey: config.get('S3_SECRET_KEY', 'local_only_change_me_please'),
          },
        });
      },
      inject: [ConfigService],
    },
    {
      provide: 'S3_PUBLIC_CLIENT',
      useFactory: (config: ConfigService) => {
        const { S3Client } = require('@aws-sdk/client-s3');
        const endpoint = config.get('S3_PUBLIC_ENDPOINT')
          ?? `${config.get('S3_USE_SSL', 'false') === 'true' ? 'https' : 'http'}://${config.get('S3_ENDPOINT', 'localhost')}:${config.get<number>('S3_PORT', 8333)}`;
        return new S3Client({
          endpoint,
          region: config.get('S3_REGION', 'us-east-1'),
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.get('S3_ACCESS_KEY', 'nexus_local'),
            secretAccessKey: config.get('S3_SECRET_KEY', 'local_only_change_me_please'),
          },
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
