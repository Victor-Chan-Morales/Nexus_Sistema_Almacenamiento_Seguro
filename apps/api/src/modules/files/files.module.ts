import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { StorageModule } from './storage/storage.module';
import { DatabaseService } from './database.service';

@Module({
  imports: [StorageModule], 
  controllers: [FilesController], 
  providers: [FilesService, DatabaseService], // Registramos DatabaseService
})
export class FilesModule {}