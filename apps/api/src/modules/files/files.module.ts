import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesController, FoldersController } from './files.controller';
import { FilesService } from './files.service';
import { TrashRetentionService } from './trash-retention.service';
import { FileVersionsService } from './file-versions.service';
import { ShareLinksService } from './share-links.service';
import { ShareLinksController } from './share-links.controller';
import { PublicShareLinksController } from './public-share-links.controller';
import { ShareLink } from './entities/share-link.entity';
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
import { DriveAccessService } from './drive-access.service';
import { DestinationsService } from './destinations.service';
import { DestinationsController } from './destinations.controller';
import { Team } from './entities/team.entity';
import { TeamMember } from './entities/team-member.entity';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { DestinationDefaults } from './destination-defaults.service';
import { DeploymentModelSource } from './ports/deployment-model-source';
import { FolderPlacementService } from './placement/folder-placement.service';
import { OrganizationRepository } from '../iam/ports/repositories';

/**
 * Módulo FILES
 * Responsable: Miguel
 *
 * Gestiona los metadatos canónicos de files.*, el Drive personal, versiones cifradas y reservas.
 * Consume StorageRouter (SPEC-801) y BillingService en proceso, y registra el hook personal-drive para
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
      ShareLink,
      Team,
      TeamMember,
    ]),
    IamModule,     // Guard JWT y RegistrationHooks
    StorageModule, // StorageRouter: guardar/recuperar bytes en el destino de cada versión
    BillingModule, // Para verificar cuota de almacenamiento
  ],
  controllers: [
    FoldersController,
    FilesController,
    ShareLinksController,
    PublicShareLinksController,
    DestinationsController,
    TeamsController,
  ],
  providers: [
    FilesService,
    TrashRetentionService,
    FileVersionsService,
    FilesCryptoService,
    DriveAccessService,
    PersonalDriveHook,
    ShareLinksService,
    DestinationsService,
    TeamsService,
    DestinationDefaults,
    // SPEC-803 (DIP): Files consulta el modelo de despliegue por su puerto; IAM lo implementa
    { provide: DeploymentModelSource, useExisting: OrganizationRepository },
    FolderPlacementService,
  ],
  exports: [FilesService, DestinationDefaults],
})
export class FilesModule {}
