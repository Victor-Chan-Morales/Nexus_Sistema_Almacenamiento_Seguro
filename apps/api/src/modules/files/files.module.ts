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
import { PersonalDriveHook } from './registration/personal-drive.hook';

/**
 * Módulo FILES
 * Responsable: Miguel
 *
 * Gestiona: carpetas, archivos, versiones y cuotas.
 * Consume StorageService y BillingService directamente mediante inyección de dependencias
 * — SIN llamadas HTTP — y registra el hook personal-drive del alta de IAM (Drive "Mi espacio",
 * carpeta raíz "Archivos" y contadores de cuota) en la transacción del registro.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([FileRecord, Folder, FileVersion]),
    IamModule,     // Guard JWT y RegistrationHooks
    StorageModule, // Para guardar/recuperar bytes en SeaweedFS
    BillingModule, // Para verificar cuota de almacenamiento
  ],
  controllers: [FilesController],
  providers: [FilesService, PersonalDriveHook],
  exports: [FilesService],
})
export class FilesModule {}
