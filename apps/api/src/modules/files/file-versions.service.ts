import {
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { StorageRouter } from '../storage/storage-router.service';
import { DriveAccessService, DriveActor } from './drive-access.service';
import { FileVersionsResponseDto } from './dto/versions.dto';
import { FileRecord } from './entities/file-record.entity';
import { FileVersion } from './entities/file-version.entity';
import { FilesCryptoService } from './files-crypto.service';
import { FilesService, versionAlreadyCurrentError } from './files.service';

/** SPEC-210: respuesta de restaurar. `versionId` y `versionNumber` son los de la versión nueva. */
export interface RestoredVersionDto {
  fileId: string;
  versionId: string;
  versionNumber: number;
  sizeBytes: number;
  uploadedAt: string;
}

/**
 * SPEC-206, SPEC-210: historial, descarga y restauración de versiones de un archivo del Drive personal.
 * Toda búsqueda pasa por DriveAccessService: un archivo ajeno, de otra organización, inexistente o en
 * papelera responde 404 sin distinguir el motivo.
 */
@Injectable()
export class FileVersionsService {
  private readonly logger = new Logger(FileVersionsService.name);

  constructor(
    @InjectRepository(FileVersion)
    private readonly versionRepository: Repository<FileVersion>,
    private readonly filesService: FilesService,
    private readonly storageRouter: StorageRouter,
    private readonly crypto: FilesCryptoService,
    private readonly driveAccess: DriveAccessService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  /**
   * SPEC-206: historial de versiones de un archivo propio y activo, de la más reciente a la más antigua.
   * Solo lectura: sin auditoría ni transacción. El select excluye object_key, DEK, KEK y checksum.
   */
  async listVersions(
    fileId: string,
    organizationId: string,
    userId: string,
  ): Promise<FileVersionsResponseDto> {
    const located = await this.driveAccess.locateFile({ organizationId, userId }, fileId);
    if (!located || located.file.isDeleted || located.folder.isDeleted) {
      throw this.notFound(fileId);
    }
    const file = located.file;
    if (!file.currentVersionId) throw this.notFound(fileId);

    const versions = await this.versionRepository.find({
      where: { fileId: file.id },
      order: { versionNumber: 'DESC' },
      select: { id: true, versionNumber: true, sizeBytes: true, uploadedAt: true },
    });
    const current = versions.find((version) => version.id === file.currentVersionId);
    if (!current) throw this.notFound(fileId);

    return {
      fileId: file.id,
      fileName: file.name,
      currentVersion: current.versionNumber,
      versions: versions.map((version) => ({
        versionId: version.id,
        versionNumber: version.versionNumber,
        sizeBytes: Number(version.sizeBytes),
        uploadedAt: version.uploadedAt.toISOString(),
        isCurrent: version.id === file.currentVersionId,
      })),
    };
  }

  /**
   * Lee el objeto de una versión y lo descifra. SPEC-216 la reutiliza: no cambiar la firma sin revisar esa spec.
   * El AAD incluye `versionNumber`, así que se descifra con el número de la versión pedida, no con el vigente.
   */
  async readVersionBytes(organizationId: string, file: FileRecord, version: FileVersion): Promise<Buffer> {
    try {
      const storage = await this.storageRouter.forRead(organizationId, version.destinationId);
      const objectStream = await storage.get(version.objectKey);
      const objectBytes = await this.readStream(objectStream);
      return this.crypto.decryptFile(
        organizationId,
        file.id,
        version.versionNumber,
        version.encryptedDek,
        version.checksum,
        objectBytes,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('No se pudo leer la versión ' + version.id + ' del archivo ' + file.id + ': ' + String(error));
      throw new InternalServerErrorException('No se pudo recuperar el archivo');
    }
  }

  /**
   * SPEC-210: bytes exactos de cualquier versión de un archivo propio y activo.
   * El nombre es `file.name`; la versión no aparece en el nombre (D4).
   */
  async downloadVersion(
    fileId: string,
    versionId: string,
    actor: DriveActor,
  ): Promise<{ stream: Readable; mimeType: string; name: string }> {
    const { file, version } = await this.locateVersion(fileId, versionId, actor);
    const plaintext = await this.readVersionBytes(actor.organizationId, file, version);
    return {
      stream: Readable.from([plaintext]),
      mimeType: file.mimeType || 'application/octet-stream',
      name: file.name,
    };
  }

  /**
   * SPEC-210: crea una versión nueva con el contenido de la indicada. No borra nada: las versiones
   * anteriores se conservan. La carga pasa por uploadMultipartFile, que aplica cuota, cifrado y límites.
   */
  async restoreVersion(
    fileId: string,
    versionId: string,
    actor: DriveActor,
  ): Promise<RestoredVersionDto> {
    const { file, version } = await this.locateVersion(fileId, versionId, actor);
    if (file.currentVersionId === version.id) throw versionAlreadyCurrentError();

    const plaintext = await this.readVersionBytes(actor.organizationId, file, version);
    const correlationId = randomUUID();
    // La carga escribe en este archivo (bloqueado por id) y decide dentro de la transacción si ya es la vigente.
    const uploaded = await this.filesService.uploadMultipartFileWithVersion({
      organizationId: actor.organizationId,
      ownerId: actor.userId,
      folderId: file.folderId,
      file: { buffer: plaintext, originalname: file.name, mimetype: file.mimeType ?? '' },
      correlationId,
      restore: { fileId: file.id, sourceVersionId: version.id, sourceChecksum: version.checksum },
    });

    // Enganche SPEC-405: FILE_VERSION_RESTORED tras el commit, con el mismo correlationId que FILE_UPLOAD
    void this.auditService?.logEvent({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: AuditAction.FILE_VERSION_RESTORED,
      resourceType: AuditResource.FILE,
      resourceId: uploaded.id,
      correlationId,
    }).catch(() => {});

    return {
      fileId: uploaded.id,
      versionId: uploaded.versionId,
      versionNumber: uploaded.versionNumber,
      sizeBytes: uploaded.sizeBytes,
      uploadedAt: uploaded.uploadedAt.toISOString(),
    };
  }

  /** Archivo activo y de carpeta activa del Drive del solicitante, con la versión pedida. Cualquier fallo es 404. */
  private async locateVersion(
    fileId: string,
    versionId: string,
    actor: DriveActor,
  ): Promise<{ file: FileRecord; version: FileVersion }> {
    const located = await this.driveAccess.locateFile(actor, fileId);
    if (!located || located.file.isDeleted || located.folder.isDeleted) throw this.notFound(fileId);

    const file = located.file;
    const version = await this.versionRepository.findOne({ where: { id: versionId, fileId: file.id } });
    if (!version) throw this.notFound(fileId);
    return { file, version };
  }

  private notFound(fileId: string): NotFoundException {
    return new NotFoundException('Archivo ' + fileId + ' no encontrado');
  }

  private async readStream(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
