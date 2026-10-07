import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Readable } from 'stream';
import { FileRecord } from './entities/file-record.entity';
import { Folder } from './entities/folder.entity';
import { FileVersion } from './entities/file-version.entity';
import { StorageService } from '../storage/storage.service';
import { BillingService } from '../billing/billing.service';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly processedRequests = new Set<string>();

  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,

    @InjectRepository(Folder)
    private readonly folderRepo: Repository<Folder>,

    @InjectRepository(FileVersion)
    private readonly versionRepo: Repository<FileVersion>,

    private readonly storageService: StorageService,
    private readonly billingService: BillingService,
  ) {}

  // ── Carpetas ──────────────────────────────────────────────────────────────

  async createFolder(
    organizationId: string,
    ownerId: string,
    name: string,
    parentId?: string,
  ): Promise<Folder> {
    if (!name || name.trim().length === 0) {
      throw new BadRequestException('El nombre de la carpeta es requerido');
    }

    if (parentId) {
      const parent = await this.folderRepo.findOne({
        where: { id: parentId, organizationId, isDeleted: false },
      });
      if (!parent) {
        throw new NotFoundException('Carpeta padre no encontrada');
      }
    }

    const folder = this.folderRepo.create({
      organizationId,
      ownerId,
      name: name.trim(),
      parentId: parentId ?? null,
    });
    return this.folderRepo.save(folder);
  }

  async listFolders(organizationId: string, parentId?: string): Promise<Folder[]> {
    return this.folderRepo.find({
      where: {
        organizationId,
        parentId: parentId ?? null,
        isDeleted: false,
      },
      order: { name: 'ASC' },
    });
  }

  async getFolderItems(organizationId: string, folderId: string) {
    if (folderId !== 'root') {
      const folder = await this.folderRepo.findOne({
        where: { id: folderId, organizationId, isDeleted: false },
      });
      if (!folder) {
        throw new NotFoundException('Carpeta no encontrada');
      }
    }

    const actualParentId = folderId === 'root' ? null : folderId;

    const [folders, files] = await Promise.all([
      this.folderRepo.find({
        where: { organizationId, parentId: actualParentId, isDeleted: false },
        order: { name: 'ASC' },
      }),
      this.fileRepo.find({
        where: { organizationId, folderId: actualParentId, isDeleted: false },
        order: { createdAt: 'DESC' },
      }),
    ]);

    return { folderId, folders, files };
  }

  // ── Aprovisionamiento IAM (Sebastián) ─────────────────────────────────────

  async provisionInitialSpace(organizationId: string, userId: string): Promise<Folder> {
    const rootName = 'Mi espacio';
    let rootFolder = await this.folderRepo.findOne({
      where: { organizationId, name: rootName, parentId: null, isDeleted: false },
    });

    if (!rootFolder) {
      rootFolder = this.folderRepo.create({
        organizationId,
        ownerId: userId,
        name: rootName,
        parentId: null,
      });
      await this.folderRepo.save(rootFolder);
    }

    return rootFolder;
  }

  // ── Archivos ──────────────────────────────────────────────────────────────

  async listFiles(organizationId: string, folderId?: string): Promise<FileRecord[]> {
    return this.fileRepo.find({
      where: { organizationId, folderId: folderId ?? null, isDeleted: false },
      order: { createdAt: 'DESC' },
    });
  }

  async uploadMultipartFile(params: {
    organizationId: string;
    ownerId: string;
    folderId?: string;
    file: any;
    idempotencyKey?: string;
  }): Promise<FileRecord> {
    const { organizationId, ownerId, folderId, file, idempotencyKey } = params;

    // Validación de Idempotencia
    if (idempotencyKey) {
      if (this.processedRequests.has(idempotencyKey)) {
        throw new ConflictException('Petición duplicada (Idempotency-Key ya procesada)');
      }
      this.processedRequests.add(idempotencyKey);
    }

    try {
      // 1. Validar cuota con BillingService (in-process)
      const storageLimit = await this.billingService.getStorageLimitBytes(organizationId);
      const usedBytes = await this.getConfirmedUsageBytes(organizationId);

      if (usedBytes + BigInt(file.size) > storageLimit) {
        throw new ForbiddenException('Cuota de almacenamiento excedida');
      }

      // 2. Validar carpeta destino si se envía
      if (folderId) {
        const folder = await this.folderRepo.findOne({
          where: { id: folderId, organizationId, isDeleted: false },
        });
        if (!folder) {
          throw new NotFoundException('Carpeta no encontrada');
        }
      }

      // 3. Crear o ubicar registro del archivo
      let fileRecord = await this.fileRepo.findOne({
        where: {
          name: file.originalname,
          organizationId,
          folderId: folderId ?? null,
          isDeleted: false,
        },
      });

      let versionNumber = 1;
      if (!fileRecord) {
        fileRecord = this.fileRepo.create({
          name: file.originalname,
          organizationId,
          ownerId,
          folderId: folderId ?? null,
          mimeType: file.mimetype,
          sizeBytes: file.size.toString(),
        });
        await this.fileRepo.save(fileRecord);
      } else {
        const lastVersion = await this.versionRepo.findOne({
          where: { fileId: fileRecord.id },
          order: { versionNumber: 'DESC' },
        });
        versionNumber = (lastVersion?.versionNumber ?? 0) + 1;
      }

      // 4. Clave de objeto multi-tenant en MinIO
      const objectKey = `${organizationId}/${fileRecord.id}/v${versionNumber}-${file.originalname}`;
      const stream = Readable.from(file.buffer);

      // 5. Guardar binario en MinIO
      await this.storageService.put(objectKey, stream, file.size, file.mimetype);

      try {
        // 6. Persistir versión en Postgres
        const version = this.versionRepo.create({
          fileId: fileRecord.id,
          versionNumber,
          objectKey,
          sizeBytes: file.size.toString(),
          uploadedBy: ownerId,
        });
        await this.versionRepo.save(version);

        fileRecord.sizeBytes = file.size.toString();
        await this.fileRepo.save(fileRecord);

        return fileRecord;
      } catch (dbError) {
        // Compensación / Rollback de archivo huérfano si falla la BD
        this.logger.error(`Fallo en BD, compensando archivo en Storage: ${objectKey}`);
        try {
          if (typeof (this.storageService as any).delete === 'function') {
            await (this.storageService as any).delete(objectKey);
          }
        } catch (storageError: any) {
          this.logger.error(`No se pudo compensar el objeto en MinIO: ${storageError.message}`);
        }
        throw dbError;
      }
    } catch (err) {
      if (idempotencyKey) {
        this.processedRequests.delete(idempotencyKey);
      }
      throw err;
    }
  }

  async downloadFileStream(
    fileId: string,
    organizationId: string,
  ): Promise<{ stream: Readable; mimeType: string; name: string }> {
    const file = await this.fileRepo.findOne({
      where: { id: fileId, organizationId, isDeleted: false },
    });
    if (!file) {
      throw new NotFoundException('Archivo no encontrado');
    }

    const lastVersion = await this.versionRepo.findOne({
      where: { fileId },
      order: { versionNumber: 'DESC' },
    });
    if (!lastVersion) {
      throw new NotFoundException('Sin versiones disponibles para este archivo');
    }

    // Obtener stream desde StorageService
    let stream: Readable;
    if (typeof (this.storageService as any).getStream === 'function') {
      stream = await (this.storageService as any).getStream(lastVersion.objectKey);
    } else if (typeof (this.storageService as any).get === 'function') {
      stream = await (this.storageService as any).get(lastVersion.objectKey);
    } else {
      throw new BadRequestException('Método de lectura no soportado por StorageService');
    }

    return {
      stream,
      mimeType: file.mimeType,
      name: file.name,
    };
  }

  async softDelete(fileId: string, organizationId: string): Promise<void> {
    const file = await this.fileRepo.findOne({
      where: { id: fileId, organizationId, isDeleted: false },
    });
    if (!file) {
      throw new NotFoundException('Archivo no encontrado');
    }
    file.isDeleted = true;
    await this.fileRepo.save(file);
  }

  // ── Cuota pública para Dashboard (Víctor) ──────────────────────────────────

  async getConfirmedUsageBytes(organizationId: string): Promise<bigint> {
    const result = await this.fileRepo
      .createQueryBuilder('f')
      .select('SUM(CAST(f.sizeBytes AS BIGINT))', 'total')
      .where('f.organizationId = :organizationId', { organizationId })
      .andWhere('f.isDeleted = false')
      .getRawOne();

    return BigInt(result?.total ?? 0);
  }
}