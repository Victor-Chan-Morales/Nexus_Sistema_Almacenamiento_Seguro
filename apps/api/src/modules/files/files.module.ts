import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesController } from './files.controller';
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
 * Gestiona: carpetas, archivos, versiones y cuotas.
 * Consume IamService, StorageService y BillingService directamente
 * mediante inyección de dependencias — SIN llamadas HTTP.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([FileRecord, Folder, FileVersion]),
    IamModule,     // Para verificar identidad del usuario
    StorageModule, // Para guardar/recuperar bytes en SeaweedFS
    BillingModule, // Para verificar cuota de almacenamiento
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
