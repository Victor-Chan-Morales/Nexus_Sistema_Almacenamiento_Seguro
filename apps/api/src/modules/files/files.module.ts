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

/**
 * Módulo FILES
 * Responsable: Miguel
 *
 * Expone endpoints de Files y Folders según el contrato acordado.
 * Consume StorageService y BillingService directamente mediante inyección modular.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([FileRecord, Folder, FileVersion]),
    IamModule,
    StorageModule,
    BillingModule,
  ],
  controllers: [FilesController, FoldersController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}