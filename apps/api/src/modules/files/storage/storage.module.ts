import { Module } from '@nestjs/common';
import { MinioStorageService } from './minio-storage.service';
import { STORAGE_PROVIDER } from './storage.provider';

@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      useClass: MinioStorageService,
    },
  ],
  exports: [STORAGE_PROVIDER], // Lo exportamos para que el servicio de archivos lo pueda usar
})
export class StorageModule {}