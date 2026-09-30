import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [StorageModule], // Importamos la conexión a MinIO
  controllers: [FilesController], // Exponemos las rutas web
  providers: [FilesService], // Registramos la lógica de negocio
})
export class FilesModule {}