import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Destination } from '../files/entities/destination.entity';
import { FilesCryptoService } from '../files/files-crypto.service';
import { StorageService } from './storage.service';
import { StorageRouter } from './storage-router.service';

/**
 * Módulo STORAGE
 * Responsable: Miguel
 *
 * Encapsula el almacenamiento de objetos mediante S3. FilesModule solo conoce StorageRouter,
 * que devuelve el almacén (ObjectStorage) del destino de cada operación (SPEC-801).
 * StorageService no se exporta: es el destino de entorno y lo usa únicamente el router.
 */
@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Destination])],
  providers: [
    StorageService,
    StorageRouter,
    // SPEC-802: el router descifra las credenciales propias de cada destino (solo las usa en memoria).
    FilesCryptoService,
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
  exports: [StorageRouter],
})
export class StorageModule {}
