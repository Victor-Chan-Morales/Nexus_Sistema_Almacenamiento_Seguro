import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesController, FoldersController } from './files.controller';
import { FilesService } from './files.service';
import { FileRecord } from './entities/file-record.entity';
import { Folder } from './entities/folder.entity';
import { FileVersion } from './entities/file-version.entity';
import { Drive } from './entities/drive.entity';
import { IamModule } from '../iam/iam.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { PersonalDriveHook } from './registration/personal-drive.hook';
import { Destination } from './entities/destination.entity';
import { TenantEncryptionKey } from './entities/tenant-encryption-key.entity';
import { Reservation } from './entities/reservation.entity';
import { TenantQuota } from './entities/tenant-quota.entity';
import { Upload } from './entities/upload.entity';
import { FilesCryptoService } from './files-crypto.service';

/**
 * Módulo FILES
 * Responsable: Miguel
 *
 * Gestiona los metadatos canónicos de files.*, el Drive personal, versiones cifradas y reservas.
 * Consume StorageService y BillingService en proceso, y registra el hook personal-drive para
 * que IAM confirme Drive, cuota, destino y referencia criptográfica en su transacción.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FileRecord,
      Folder,
      FileVersion,
      Drive,
      Destination,
      TenantEncryptionKey,
      Reservation,
      TenantQuota,
      Upload,
    ]),
    IamModule,     // Guard JWT y RegistrationHooks
    StorageModule, // Para guardar/recuperar bytes en SeaweedFS
    BillingModule, // Para verificar cuota de almacenamiento
  ],
  controllers: [FoldersController, FilesController],
  providers: [FilesService, FilesCryptoService, PersonalDriveHook],
  exports: [FilesService],
})
export class FilesModule {}
