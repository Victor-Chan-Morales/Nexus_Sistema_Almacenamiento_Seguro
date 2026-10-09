import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesController, FoldersController } from './files.controller';
import { FilesService } from './files.service';
import { FileRecord } from './entities/file-record.entity';
import { Folder } from './entities/folder.entity';
import { FileVersion } from './entities/file-version.entity';
import { IamModule } from '../iam/iam.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileRecord, Folder, FileVersion]),
    IamModule,     // Para verificar identidad y contexto de tenant
    StorageModule, // Para persistir y recuperar bytes en SeaweedFS (S3)
    BillingModule, // Para verificar cuota de almacenamiento
  ],
  controllers: [FilesController, FoldersController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}