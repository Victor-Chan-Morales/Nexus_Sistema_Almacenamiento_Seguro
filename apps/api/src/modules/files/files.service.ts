import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  ConflictException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Readable } from 'stream';
import * as path from 'path';
import { FileRecord } from './entities/file-record.entity';
import { Folder } from './entities/folder.entity';
import { FileVersion } from './entities/file-version.entity';
import { Drive } from './entities/drive.entity';
import { StorageService } from '../storage/storage.service';
import { BillingService } from '../billing/billing.service';

// Exactamente 100,000,000 bytes según CONTRACTS.md
const MAX_FILE_SIZE_BYTES = 100000000;

// Lista canónica de tipos admitidos con validación cruzada de extensión y MIME
const ALLOWED_MIME_BY_EXT: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.doc': ['application/msword'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.xls': ['application/vnd.ms-excel'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.ppt': ['application/vnd.ms-powerpoint'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.txt': ['text/plain'],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
};

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  // Registro de idempotencia en memoria
  private readonly idempotencyCache = new Map<
    string,
    { status: 'processing' | 'completed'; response?: any; timestamp: number }
  >();

  // Control de concurrencia: máx 3 cargas simultáneas por usuario (ADR-003)
  private readonly activeUploadsByUser = new Map<string, number>();

  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRepository: Repository<FileRecord>,
    @InjectRepository(Folder)
    private readonly folderRepository: Repository<Folder>,
    @InjectRepository(FileVersion)
    private readonly versionRepository: Repository<FileVersion>,
    @InjectRepository(Drive)
    private readonly driveRepository: Repository<Drive>,
    private readonly storageService: StorageService,
    private readonly billingService: BillingService,
  ) {
    setInterval(() => {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      for (const [key, value] of this.idempotencyCache.entries()) {
        if (value.timestamp < oneHourAgo) {
          this.idempotencyCache.delete(key);
        }
      }
    }, 30 * 60 * 1000).unref();
  }

  /**
   * Obtiene o inicializa el Drive personal y la carpeta raíz de la organización
   */
  async getOrCreateUserDrive(
    organizationId: string,
    userId: string,
  ): Promise<{ id: string; name: string; rootFolderId: string }> {
    let drive = await this.driveRepository.findOne({
      where: { organizationId, ownerUserId: userId },
    });

    if (!drive) {
      drive = this.driveRepository.create({
        organizationId,
        ownerUserId: userId,
        name: 'Mi espacio',
        type: 'personal',
      });
      drive = await this.driveRepository.save(drive);
    }

    let rootFolder = await this.folderRepository.findOne({
      where: {
        organizationId,
        driveId: drive.id,
        parentId: IsNull(),
        isDeleted: false,
      },
    });

    if (!rootFolder) {
      rootFolder = this.folderRepository.create({
        organizationId,
        ownerId: userId,
        driveId: drive.id,
        name: 'Archivos',
        parentId: null,
        isDeleted: false,
      });
      rootFolder = await this.folderRepository.save(rootFolder);
    }

    return {
      id: drive.id,
      name: drive.name,
      rootFolderId: rootFolder.id,
    };
  }

  /**
   * Listar carpetas devolviendo el Drive y la lista de elementos
   */
  async listFolders(
    organizationId: string,
    userId: string,
    parentId?: string,
  ): Promise<{
    drive: { id: string; name: string; rootFolderId: string };
    items: Array<{ id: string; name: string; parentFolderId: string | null; driveId: string }>;
  }> {
    const driveInfo = await this.getOrCreateUserDrive(organizationId, userId);

    const folders = await this.folderRepository.find({
      where: {
        organizationId,
        parentId: parentId ? parentId : IsNull(),
        isDeleted: false,
      },
      order: { name: 'ASC' },
    });

    return {
      drive: driveInfo,
      items: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentFolderId: f.parentId,
        driveId: f.driveId || driveInfo.id,
      })),
    };
  }

  /**
   * Crear carpeta garantizando driveId y aislamiento de organización
   */
  async createFolder(
    organizationId: string,
    ownerId: string,
    name: string,
    parentId?: string,
  ): Promise<{ id: string; name: string; parentFolderId: string | null; driveId: string; createdAt: Date }> {
    const driveInfo = await this.getOrCreateUserDrive(organizationId, ownerId);

    if (parentId) {
      const parent = await this.folderRepository.findOne({
        where: { id: parentId, organizationId, isDeleted: false },
      });
      if (!parent) {
        throw new NotFoundException(
          `Carpeta padre ${parentId} no encontrada o fuera del alcance de la organización`,
        );
      }
    }

    const folder = this.folderRepository.create({
      organizationId,
      ownerId,
      driveId: driveInfo.id,
      name: name.trim(),
      parentId: parentId || null,
      isDeleted: false,
    });

    const saved = await this.folderRepository.save(folder);

    return {
      id: saved.id,
      name: saved.name,
      parentFolderId: saved.parentId,
      driveId: saved.driveId,
      createdAt: saved.createdAt,
    };
  }

  /**
   * Obtener items de carpeta con el contenedor 'folder' y metadatos de versión de archivos
   */
  async getFolderItems(
    organizationId: string,
    folderId: string,
  ): Promise<{
    folder: { id: string; name: string; parentFolderId: string | null; driveId: string; createdAt: Date };
    folders: Array<{ id: string; name: string; parentFolderId: string | null; driveId: string; createdAt: Date }>;
    files: Array<{ id: string; name: string; mimeType: string; sizeBytes: string; versionId: string; uploadedAt: Date }>;
  }> {
    const folder = await this.folderRepository.findOne({
      where: { id: folderId, organizationId, isDeleted: false },
    });
    if (!folder) {
      throw new NotFoundException(`Carpeta ${folderId} no encontrada`);
    }

    const [folders, files] = await Promise.all([
      this.folderRepository.find({
        where: { organizationId, parentId: folderId, isDeleted: false },
        order: { name: 'ASC' },
      }),
      this.fileRepository.find({
        where: { organizationId, folderId, isDeleted: false },
        relations: ['versions'],
        order: { name: 'ASC' },
      }),
    ]);

    const formattedFiles = files.map((file) => {
      const sortedVersions = (file.versions || []).sort(
        (a, b) => b.versionNumber - a.versionNumber,
      );
      const latest = sortedVersions[0];

      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType || 'application/octet-stream',
        sizeBytes: latest ? String(latest.sizeBytes) : String(file.sizeBytes),
        versionId: latest ? latest.id : file.id,
        uploadedAt: latest ? latest.uploadedAt : file.createdAt,
      };
    });

    return {
      folder: {
        id: folder.id,
        name: folder.name,
        parentFolderId: folder.parentId,
        driveId: folder.driveId,
        createdAt: folder.createdAt,
      },
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentFolderId: f.parentId,
        driveId: f.driveId,
        createdAt: f.createdAt,
      })),
      files: formattedFiles,
    };
  }

  /**
   * Listar archivos de la organización con metadatos de versión
   */
  async listFiles(
    organizationId: string,
    folderId?: string,
  ): Promise<Array<{ id: string; name: string; mimeType: string; sizeBytes: string; versionId: string; uploadedAt: Date }>> {
    const files = await this.fileRepository.find({
      where: {
        organizationId,
        folderId: folderId ? folderId : IsNull(),
        isDeleted: false,
      },
      relations: ['versions'],
      order: { createdAt: 'DESC' },
    });

    return files.map((file) => {
      const sortedVersions = (file.versions || []).sort(
        (a, b) => b.versionNumber - a.versionNumber,
      );
      const latest = sortedVersions[0];

      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: latest ? String(latest.sizeBytes) : String(file.sizeBytes),
        versionId: latest ? latest.id : file.id,
        uploadedAt: latest ? latest.uploadedAt : file.createdAt,
      };
    });
  }

  /**
   * Cálculo real de cuota (ADR-003): todas las versiones incluyendo papelera
   */
  async getUsedStorageBytes(organizationId: string): Promise<bigint> {
    const result = await this.versionRepository
      .createQueryBuilder('version')
      .innerJoin('version.fileRecord', 'file')
      .select('COALESCE(SUM(CAST(version.sizeBytes AS BIGINT)), 0)', 'totalBytes')
      .where('file.organizationId = :organizationId', { organizationId })
      .getRawOne();

    return BigInt(result?.totalBytes || 0);
  }

  /**
   * Uso de almacenamiento para el SubscriptionCoordinator de integración (Billing).
   * Las reservas atómicas de carga todavía no existen en este corte, así que van en cero
   * y `totalBytes` equivale al uso confirmado; cuando Files agregue la tabla de reservas,
   * solo cambia este método.
   */
  async getTotalStorageUsage(
    organizationId: string,
  ): Promise<{ usedBytes: bigint; reservedBytes: bigint; totalBytes: bigint }> {
    const usedBytes = await this.getUsedStorageBytes(organizationId);
    return { usedBytes, reservedBytes: 0n, totalBytes: usedBytes };
  }

  /**
   * Subida de archivo validando cuota (422), tamaño (413), MIME (415),
   * concurrencia (3 máx) e idempotencia.
   */
  async uploadMultipartFile(params: {
    organizationId: string;
    ownerId: string;
    folderId: string;
    file: any;
    idempotencyKey?: string;
  }): Promise<{
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: string;
    versionId: string;
    uploadedAt: Date;
  }> {
    const { organizationId, ownerId, folderId, file, idempotencyKey } = params;

    // folderId es obligatorio según contrato
    if (!folderId) {
      throw new BadRequestException('El parámetro folderId es obligatorio');
    }

    // Límite de 3 cargas concurrentes por usuario (ADR-003)
    const currentActive = this.activeUploadsByUser.get(ownerId) || 0;
    if (currentActive >= 3) {
      throw new HttpException(
        'Límite de tres cargas simultáneas alcanzado para este usuario',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.activeUploadsByUser.set(ownerId, currentActive + 1);

    const cacheKey = idempotencyKey ? `${organizationId}:${idempotencyKey}` : null;
    if (cacheKey) {
      const cached = this.idempotencyCache.get(cacheKey);
      if (cached) {
        this.decrementActiveUploads(ownerId);
        if (cached.status === 'processing') {
          throw new ConflictException(
            'Operación en procesamiento con la misma Idempotency-Key. Reintente en breve.',
          );
        }
        return cached.response;
      }
      this.idempotencyCache.set(cacheKey, { status: 'processing', timestamp: Date.now() });
    }

    try {
      if (!file) {
        throw new UnsupportedMediaTypeException('No se ha proporcionado ningún archivo');
      }

      const fileSize = Number(file.size || (file.buffer ? file.buffer.length : 0));
      const originalName = file.originalname || 'archivo';
      const fileExt = path.extname(originalName).toLowerCase();
      const declaredMime = (file.mimetype || '').toLowerCase();

      // Validación exacta de tamaño: 100,000,000 bytes (HTTP 413)
      if (fileSize > MAX_FILE_SIZE_BYTES) {
        throw new PayloadTooLargeException('El archivo excede el tamaño máximo permitido de 100000000 bytes');
      }

      // Validación estricta y coherente de extensión + MIME (HTTP 415)
      const allowedMimes = ALLOWED_MIME_BY_EXT[fileExt];
      if (!allowedMimes || !allowedMimes.includes(declaredMime)) {
        throw new UnsupportedMediaTypeException(
          `Formato de archivo no admitido: ${declaredMime} (${fileExt}). Permitidos: PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT y ZIP`,
        );
      }

      // Verificación de carpeta de destino en el tenant
      const folder = await this.folderRepository.findOne({
        where: { id: folderId, organizationId, isDeleted: false },
      });
      if (!folder) {
        throw new NotFoundException(`Carpeta ${folderId} no encontrada`);
      }

      // Verificación de cuota de almacenamiento: debe responder 422 con STORAGE_QUOTA_EXCEEDED
      const storageLimit = await this.billingService.getStorageLimitBytes(organizationId);
      const usedBytes = await this.getUsedStorageBytes(organizationId);

      if (usedBytes + BigInt(fileSize) > storageLimit) {
        throw new HttpException(
          {
            statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
            error: 'Unprocessable Entity',
            code: 'STORAGE_QUOTA_EXCEEDED',
            message: 'La carga excede la cuota de almacenamiento disponible para su plan',
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      // Versionado secuencial (ADR-003)
      let fileRecord = await this.fileRepository.findOne({
        where: {
          organizationId,
          folderId,
          name: originalName,
          isDeleted: false,
        },
      });

      let isNewRecord = false;
      let nextVersionNumber = 1;

      if (!fileRecord) {
        fileRecord = this.fileRepository.create({
          name: originalName,
          organizationId,
          ownerId,
          folderId,
          mimeType: declaredMime,
          sizeBytes: String(fileSize),
          isDeleted: false,
        });
        fileRecord = await this.fileRepository.save(fileRecord);
        isNewRecord = true;
      } else {
        const latestVersion = await this.versionRepository.findOne({
          where: { fileId: fileRecord.id },
          order: { versionNumber: 'DESC' },
        });
        nextVersionNumber = (latestVersion?.versionNumber || 1) + 1;
      }

      // Clave opaca en SeaweedFS: <tenant>/<fileId>/v<num>
      const objectKey = `${organizationId}/${fileRecord.id}/v${nextVersionNumber}`;

      const fileVersion = this.versionRepository.create({
        fileId: fileRecord.id,
        versionNumber: nextVersionNumber,
        objectKey,
        sizeBytes: String(fileSize),
        uploadedBy: ownerId,
      });

      try {
        await this.storageService.put(
          objectKey,
          file.buffer || file.stream,
          fileSize,
          declaredMime,
        );

        const savedVersion = await this.versionRepository.save(fileVersion);

        fileRecord.sizeBytes = String(fileSize);
        fileRecord.mimeType = declaredMime;
        await this.fileRepository.save(fileRecord);

        const responseDto = {
          id: fileRecord.id,
          name: fileRecord.name,
          mimeType: fileRecord.mimeType,
          sizeBytes: fileRecord.sizeBytes,
          versionId: savedVersion.id,
          uploadedAt: savedVersion.uploadedAt,
        };

        if (cacheKey) {
          this.idempotencyCache.set(cacheKey, {
            status: 'completed',
            response: responseDto,
            timestamp: Date.now(),
          });
        }

        return responseDto;
      } catch (storageError: any) {
        this.logger.error(`Error persistiendo en SeaweedFS: ${storageError?.message || storageError}`);
        await this.storageService.delete(objectKey).catch(() => null);
        if (isNewRecord && fileRecord?.id) {
          await this.fileRepository.delete(fileRecord.id).catch(() => null);
        }
        throw new InternalServerErrorException('Error al persistir el archivo en el almacenamiento');
      }
    } catch (err) {
      if (cacheKey) {
        this.idempotencyCache.delete(cacheKey);
      }
      throw err;
    } finally {
      this.decrementActiveUploads(ownerId);
    }
  }

  private decrementActiveUploads(userId: string): void {
    const current = this.activeUploadsByUser.get(userId) || 1;
    if (current <= 1) {
      this.activeUploadsByUser.delete(userId);
    } else {
      this.activeUploadsByUser.set(userId, current - 1);
    }
  }

  /**
   * Descarga binaria por stream validando aislamiento multi-tenant
   */
  async downloadFileStream(
    fileId: string,
    organizationId: string,
  ): Promise<{ stream: Readable; mimeType: string; name: string }> {
    const file = await this.fileRepository.findOne({
      where: { id: fileId, organizationId, isDeleted: false },
    });

    if (!file) {
      throw new NotFoundException(`Archivo ${fileId} no encontrado`);
    }

    const latestVersion = await this.versionRepository.findOne({
      where: { fileId: file.id },
      order: { versionNumber: 'DESC' },
    });

    if (!latestVersion) {
      throw new NotFoundException(`Versión no encontrada para el archivo ${fileId}`);
    }

    const stream = await this.storageService.get(latestVersion.objectKey);

    return {
      stream,
      mimeType: file.mimeType || 'application/octet-stream',
      name: file.name,
    };
  }

  /**
   * Eliminación lógica (soft-delete)
   */
  async softDelete(fileId: string, organizationId: string): Promise<FileRecord> {
    const file = await this.fileRepository.findOne({
      where: { id: fileId, organizationId, isDeleted: false },
    });

    if (!file) {
      throw new NotFoundException(`Archivo ${fileId} no encontrado`);
    }

    file.isDeleted = true;
    return this.fileRepository.save(file);
  }
}