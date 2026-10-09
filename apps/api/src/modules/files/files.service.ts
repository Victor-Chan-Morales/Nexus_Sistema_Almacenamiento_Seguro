import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Readable } from 'stream';
import { FileRecord } from './entities/file-record.entity';
import { Folder } from './entities/folder.entity';
import { FileVersion } from './entities/file-version.entity';
import { StorageService } from '../storage/storage.service';
import { BillingService } from '../billing/billing.service';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRepository: Repository<FileRecord>,
    @InjectRepository(Folder)
    private readonly folderRepository: Repository<Folder>,
    @InjectRepository(FileVersion)
    private readonly versionRepository: Repository<FileVersion>,
    private readonly storageService: StorageService,
    private readonly billingService: BillingService,
  ) {}

  /**
   * Listar carpetas de una organización con soporte de navegación jerárquica
   */
  async listFolders(organizationId: string, parentId?: string): Promise<Folder[]> {
    return this.folderRepository.find({
      where: {
        organizationId,
        parentId: parentId ? parentId : IsNull(),
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
        where: { id: parentId, organizationId },
      });
      if (!parent) {
        throw new NotFoundException(
          `Carpeta padre ${parentId} no encontrada o no pertenece a la organización`,
        );
      }
    }

    const folder = this.folderRepository.create({
      organizationId,
      ownerId,
      name,
      parentId: parentId || null,
    });

    return this.folderRepository.save(folder);
  }

  /**
   * Explorar el contenido de una carpeta (subcarpetas y archivos)
   */
  async getFolderItems(organizationId: string, folderId: string) {
    const folder = await this.folderRepository.findOne({
      where: { id: folderId, organizationId },
    });
    if (!folder) {
      throw new NotFoundException(`Carpeta ${folderId} no encontrada`);
    }

    const [folders, files] = await Promise.all([
      this.folderRepository.find({
        where: { organizationId, parentId: folderId },
        order: { name: 'ASC' },
      }),
      this.fileRepository.find({
        where: { organizationId, folderId, isDeleted: false },
        order: { name: 'ASC' },
      }),
    ]);

    return { folder, folders, files };
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
   * Cálculo de almacenamiento utilizado para verificación de cuota
   */
  async getUsedStorageBytes(organizationId: string): Promise<bigint> {
    const result = await this.fileRepository
      .createQueryBuilder('file')
      .select('SUM(CAST(file.sizeBytes AS BIGINT))', 'totalBytes')
      .where('file.organizationId = :organizationId', { organizationId })
      .andWhere('file.isDeleted = false')
      .getRawOne();

    return BigInt(result?.totalBytes || 0);
  }

  /**
   * Subida de archivo multipart con validación de cuota, metadatos y SeaweedFS
   */
  async uploadMultipartFile(params: {
    organizationId: string;
    ownerId: string;
    folderId?: string;
    file: any;
    idempotencyKey?: string;
  }): Promise<FileRecord> {
    const { organizationId, ownerId, folderId, file } = params;

    if (!file) {
      throw new BadRequestException('No se ha proporcionado ningún archivo');
    }

    const fileSize = file.size || (file.buffer ? file.buffer.length : 0);

    // 1. Verificación de cuota in-process contra BillingService
    const storageLimit = await this.billingService.getStorageLimitBytes(organizationId);
    const usedBytes = await this.getUsedStorageBytes(organizationId);

    if (usedBytes + BigInt(fileSize) > storageLimit) {
      throw new ForbiddenException('Cuota de almacenamiento excedida');
    }

    // 2. Validación de carpeta de destino
    if (folderId) {
      const folder = await this.folderRepository.findOne({
        where: { id: folderId, organizationId },
      });
      if (!folder) {
        throw new NotFoundException(`Carpeta ${folderId} no encontrada`);
      }
    }

    // 3. Crear registro de metadatos en PostgreSQL
    const fileRecord = this.fileRepository.create({
      name: file.originalname || 'archivo',
      organizationId,
      ownerId,
      folderId: folderId || null,
      mimeType: file.mimetype || 'application/octet-stream',
      sizeBytes: String(fileSize),
      isDeleted: false,
    });

    const savedFile = await this.fileRepository.save(fileRecord);

    // 4. Clave de almacenamiento generada por backend con prefijo de tenant
    const versionNumber = 1;
    const objectKey = `${organizationId}/${savedFile.id}/v${versionNumber}-${file.originalname}`;

    const fileVersion = this.versionRepository.create({
      fileId: savedFile.id,
      versionNumber,
      objectKey,
      sizeBytes: String(fileSize),
      uploadedBy: ownerId as any,
    });

    // 5. Envío de bytes a SeaweedFS pasando (key, body, size, mimeType)
    try {
      await this.storageService.put(
        objectKey,
        file.buffer || file.stream,
        fileSize,
        file.mimetype || 'application/octet-stream',
      );
      await this.versionRepository.save(fileVersion);
    } catch (error: any) {
      this.logger.error(`Error guardando en SeaweedFS: ${error?.message || error}`);
      await this.storageService.delete(objectKey).catch((delErr: any) => {
        this.logger.warn(`Fallo al compensar borrado: ${delErr?.message || delErr}`);
      });
      await this.fileRepository.delete(savedFile.id).catch(() => null);
      throw new InternalServerErrorException('Error al persistir el archivo en el almacenamiento');
    }

    return savedFile;
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
      mimeType: file.mimeType,
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

  /**
   * Búsqueda por ID con validación de tenant
   */
  async findFileById(fileId: string, organizationId: string): Promise<FileRecord> {
    const file = await this.fileRepository.findOne({
      where: { id: fileId, organizationId },
    });

    if (!file) {
      throw new NotFoundException(`Archivo ${fileId} no encontrado`);
    }

    return file;
  }
}