import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesController, FoldersController } from './files.controller';
import { FilesService } from './files.service';
import { FileRecord } from './entities/file-record.entity';
import { Folder } from './entities/folder.entity';
import { FileVersion } from './entities/file-version.entity';
import { Drive } from './entities/drive.entity';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileRecord, Folder, FileVersion, Drive]),
    StorageModule,
    BillingModule,
  ],
  controllers: [FoldersController, FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}