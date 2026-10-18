import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  ConflictException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Readable } from 'stream';
import * as path from 'path';
import { FileRecord } from './entities/file-record.entity';
import { Folder } from './entities/folder.entity';
import { FileVersion } from './entities/file-version.entity';
import { StorageService } from '../storage/storage.service';
import { BillingService } from '../billing/billing.service';

// Tipos permitidos según ADR-003: PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT, ZIP
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'image/jpeg',
  'image/png',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.jpg', '.jpeg', '.png', '.txt', '.zip',
]);

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  // Registro de idempotencia en memoria: clave -> estado / respuesta
  private readonly idempotencyCache = new Map<
    string,
    { status: 'processing' | 'completed'; response?: any; timestamp: number }
  >();

  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRepository: Repository<FileRecord>,
    @InjectRepository(Folder)
    private readonly folderRepository: Repository<Folder>,
    @InjectRepository(FileVersion)
    private readonly versionRepository: Repository<FileVersion>,
    private readonly storageService: StorageService,
    private readonly billingService: BillingService,
  ) {
    // Limpieza periódica de claves de idempotencia cada 30 minutos
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
   * Listar carpetas de una organización con soporte de navegación jerárquica
   */
  async listFolders(organizationId: string, parentId?: string): Promise<Folder[]> {
    return this.folderRepository.find({
      where: {
        organizationId,
        parentId: parentId ? parentId : IsNull(),
        isDeleted: false,
      },
      order: { name: 'ASC' },
    });
  }

  /**
   * Crear una carpeta asociada a la organización activa
   */
  async createFolder(
    organizationId: string,
    ownerId: string,
    name: string,
    parentId?: string,
  ): Promise<Folder> {
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
      name: name.trim(),
      parentId: parentId || null,
      isDeleted: false,
    });

    return this.folderRepository.save(folder);
  }

  /**
   * Explorar el contenido de una carpeta (subcarpetas y archivos)
   */
  async getFolderItems(
    organizationId: string,
    folderId: string,
  ): Promise<{ folders: Folder[]; files: FileRecord[] }> {
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
        order: { name: 'ASC' },
      }),
    ]);

    return { folders, files };
  }

  /**
   * Listar archivos de la organización (en raíz o dentro de una carpeta)
   */
  async listFiles(organizationId: string, folderId?: string): Promise<FileRecord[]> {
    return this.fileRepository.find({
      where: {
        organizationId,
        folderId: folderId ? folderId : IsNull(),
        isDeleted: false,
      },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Cálculo real de almacenamiento según ADR-003:
   * Suma todas las versiones físicas (file_versions), incluyendo archivos en papelera,
   * sin duplicar conteos.
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
   * Subida de archivo con idempotencia, versionado incremental, claves opacas
   * y compensación atómica ante fallos.
   */
  async uploadMultipartFile(params: {
    organizationId: string;
    ownerId: string;
    folderId?: string;
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

    // 1. Manejo de Idempotencia
    const cacheKey = idempotencyKey ? `${organizationId}:${idempotencyKey}` : null;
    if (cacheKey) {
      const cached = this.idempotencyCache.get(cacheKey);
      if (cached) {
        if (cached.status === 'processing') {
          throw new ConflictException(
            'Operación en procesamiento con la misma Idempotency-Key. Reintente en unos momentos.',
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
      const mimeType = file.mimetype || 'application/octet-stream';

      // 2. Validación de tamaño (HTTP 413)
      if (fileSize > MAX_FILE_SIZE_BYTES) {
        throw new PayloadTooLargeException('El archivo excede el tamaño máximo permitido de 100 MB');
      }

      // 3. Validación de tipo MIME y extensión (HTTP 415)
      const isMimeAllowed = ALLOWED_MIME_TYPES.has(mimeType);
      const isExtAllowed = ALLOWED_EXTENSIONS.has(fileExt);
      if (!isMimeAllowed && !isExtAllowed) {
        throw new UnsupportedMediaTypeException(
          `Tipo de archivo no permitido: ${mimeType} (${fileExt}). Formatos admitidos: PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT y ZIP.`,
        );
      }

      // 4. Verificación de cuota disponible (HTTP 413)
      const storageLimit = await this.billingService.getStorageLimitBytes(organizationId);
      const usedBytes = await this.getUsedStorageBytes(organizationId);

      if (usedBytes + BigInt(fileSize) > storageLimit) {
        throw new PayloadTooLargeException(
          'La carga excede la cuota de almacenamiento disponible para su plan',
        );
      }

      // 5. Validación de carpeta destino
      if (folderId) {
        const folder = await this.folderRepository.findOne({
          where: { id: folderId, organizationId, isDeleted: false },
        });
        if (!folder) {
          throw new NotFoundException(`Carpeta ${folderId} no encontrada`);
        }
      }

      // 6. Versionado según ADR-003: buscar si el archivo ya existe en la misma carpeta
      let fileRecord = await this.fileRepository.findOne({
        where: {
          organizationId,
          folderId: folderId ? folderId : IsNull(),
          name: originalName,
          isDeleted: false,
        },
      });

      let isNewRecord = false;
      let nextVersionNumber = 1;

      if (!fileRecord) {
        // Crear nuevo registro maestro
        fileRecord = this.fileRepository.create({
          name: originalName,
          organizationId,
          ownerId,
          folderId: folderId || null,
          mimeType,
          sizeBytes: String(fileSize),
          isDeleted: false,
        });
        fileRecord = await this.fileRepository.save(fileRecord);
        isNewRecord = true;
      } else {
        // Obtener última versión existente para incrementar
        const latestVersion = await this.versionRepository.findOne({
          where: { fileId: fileRecord.id },
          order: { versionNumber: 'DESC' },
        });
        nextVersionNumber = (latestVersion?.versionNumber || 1) + 1;
      }

      // 7. Generación de clave S3 interna y opaca (sin incrustar originalname)
      const objectKey = `${organizationId}/${fileRecord.id}/v${nextVersionNumber}`;

      const fileVersion = this.versionRepository.create({
        fileId: fileRecord.id,
        versionNumber: nextVersionNumber,
        objectKey,
        sizeBytes: String(fileSize),
        uploadedBy: ownerId,
      });

      // 8. Envío a SeaweedFS con rollback compensatorio ante fallos
      try {
        await this.storageService.put(
          objectKey,
          file.buffer || file.stream,
          fileSize,
          mimeType,
        );

        const savedVersion = await this.versionRepository.save(fileVersion);

        // Actualizar el FileRecord con el tamaño de su última versión
        fileRecord.sizeBytes = String(fileSize);
        fileRecord.mimeType = mimeType;
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
        this.logger.error(`Fallo en SeaweedFS: ${storageError?.message || storageError}`);
        // Compensación: eliminar objeto en storage y registro si era nuevo
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