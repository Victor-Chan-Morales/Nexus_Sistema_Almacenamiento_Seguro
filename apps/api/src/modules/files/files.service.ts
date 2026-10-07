import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Readable } from 'stream';
import { FileRecord } from './entities/file-record.entity';
import { Folder } from './entities/folder.entity';
import { FileVersion } from './entities/file-version.entity';
import { StorageService } from '../storage/storage.service';
import { BillingService } from '../billing/billing.service';

/**
 * FilesService — gestión de carpetas, archivos, versiones y cuotas.
 *
 * NOTA CLAVE del monolito modular:
 *   - StorageService se inyecta directamente (NO llamada HTTP)
 *   - BillingService se inyecta directamente (NO llamada HTTP)
 *   Ambos viven en el mismo proceso NestJS.
 */
@Injectable()
export class FilesService {
  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,

    @InjectRepository(Folder)
    private readonly folderRepo: Repository<Folder>,

    @InjectRepository(FileVersion)
    private readonly versionRepo: Repository<FileVersion>,

    // Inyección directa — mismo proceso, sin HTTP
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
    const folder = this.folderRepo.create({ organizationId, ownerId, name, parentId });
    return this.folderRepo.save(folder);
  }

  async listFolders(organizationId: string, parentId?: string): Promise<Folder[]> {
    return this.folderRepo.find({
      where: { organizationId, parentId: parentId ?? null, isDeleted: false },
    });
  }

  // ── Archivos ──────────────────────────────────────────────────────────────

  async listFiles(organizationId: string, folderId?: string): Promise<FileRecord[]> {
    return this.fileRepo.find({
      where: { organizationId, folderId: folderId ?? null, isDeleted: false },
      order: { createdAt: 'DESC' },
    });
  }

  async uploadFile(params: {
    organizationId: string;
    ownerId: string;
    folderId?: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    stream: Readable;
  }): Promise<FileRecord> {
    // 1. Verificar cuota — llamada directa a BillingService (sin HTTP)
    const storageLimit = await this.billingService.getStorageLimitBytes(params.organizationId);
    const usedBytes = await this.getUsedStorageBytes(params.organizationId);

    if (usedBytes + BigInt(params.sizeBytes) > storageLimit) {
      throw new ForbiddenException('Cuota de almacenamiento excedida');
    }

    // 2. Crear registro del archivo
    let fileRecord = await this.fileRepo.findOne({
      where: {
        name: params.name,
        organizationId: params.organizationId,
        folderId: params.folderId ?? null,
        isDeleted: false,
      },
    });

    let versionNumber = 1;
    if (!fileRecord) {
      fileRecord = this.fileRepo.create({
        name: params.name,
        organizationId: params.organizationId,
        ownerId: params.ownerId,
        folderId: params.folderId,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes.toString(),
      });
      await this.fileRepo.save(fileRecord);
    } else {
      const lastVersion = await this.versionRepo.findOne({
        where: { fileId: fileRecord.id },
        order: { versionNumber: 'DESC' },
      });
      versionNumber = (lastVersion?.versionNumber ?? 0) + 1;
    }

    // 3. Generar clave de objeto con prefijo de organización (seguridad multi-tenant)
    const objectKey = `${params.organizationId}/${fileRecord.id}/v${versionNumber}`;

    // 4. Guardar en MinIO — llamada directa a StorageService (sin HTTP)
    await this.storageService.put(objectKey, params.stream, params.sizeBytes, params.mimeType);

    // 5. Registrar versión
    const version = this.versionRepo.create({
      fileId: fileRecord.id,
      versionNumber,
      objectKey,
      sizeBytes: params.sizeBytes.toString(),
      uploadedBy: params.ownerId,
    });
    await this.versionRepo.save(version);

    // 6. Actualizar tamaño del archivo
    fileRecord.sizeBytes = params.sizeBytes.toString();
    await this.fileRepo.save(fileRecord);

    return fileRecord;
  }

  async getDownloadUrl(fileId: string, organizationId: string): Promise<string> {
    const file = await this.fileRepo.findOneBy({ id: fileId, organizationId, isDeleted: false });
    if (!file) throw new NotFoundException('Archivo no encontrado');

    const lastVersion = await this.versionRepo.findOne({
      where: { fileId },
      order: { versionNumber: 'DESC' },
    });
    if (!lastVersion) throw new NotFoundException('Sin versiones disponibles');

    // Llamada directa a StorageService — sin HTTP
    return this.storageService.getPresignedUrl(lastVersion.objectKey);
  }

  async softDelete(fileId: string, organizationId: string): Promise<void> {
    const file = await this.fileRepo.findOneBy({ id: fileId, organizationId });
    if (!file) throw new NotFoundException('Archivo no encontrado');
    file.isDeleted = true;
    await this.fileRepo.save(file);
  }

  // ── Cuota ─────────────────────────────────────────────────────────────────

  private async getUsedStorageBytes(organizationId: string): Promise<bigint> {
    const result = await this.fileRepo
      .createQueryBuilder('f')
      .select('SUM(CAST(f.sizeBytes AS BIGINT))', 'total')
      .where('f.organizationId = :organizationId', { organizationId })
      .andWhere('f.isDeleted = false')
      .getRawOne();
    return BigInt(result?.total ?? 0);
  }
}
