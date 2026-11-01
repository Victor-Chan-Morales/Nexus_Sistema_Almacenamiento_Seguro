import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { BillingService } from '../billing/billing.service';
import { StorageService } from '../storage/storage.service';
import { Destination } from './entities/destination.entity';
import { Drive } from './entities/drive.entity';
import { FileRecord } from './entities/file-record.entity';
import { FileVersion } from './entities/file-version.entity';
import { Folder } from './entities/folder.entity';
import { Reservation } from './entities/reservation.entity';
import { TenantEncryptionKey } from './entities/tenant-encryption-key.entity';
import { TenantQuota } from './entities/tenant-quota.entity';
import { Upload } from './entities/upload.entity';
import { EncryptedFile, FilesCryptoService } from './files-crypto.service';
import { PurgeFileResponseDto, RestoreFileResponseDto, RestoreFolderResponseDto, TrashItemDto, TrashResponseDto } from './dto/trash.dto';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';

const MAX_FILE_SIZE_BYTES = 100_000_000;
const MAX_ACTIVE_UPLOADS_PER_USER = 3;
const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;
/** Días en papelera tras los que un archivo eliminado deja de contar para la cuota (SPEC-202). */
const TRASH_RETENTION_DAYS = 30;

interface FolderTreeRow {
  id: string;
  name: string;
  parentFolderId: string | null;
  depth: number;
  deletedAt: Date | null;
}

const ALLOWED_MIME_BY_EXT: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.txt': ['text/plain'],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
};

interface StorageUsage {
  usedBytes: bigint;
  reservedBytes: bigint;
  totalBytes: bigint;
}

interface UploadReservation {
  uploadId: string;
  reservationId: string;
  existingResponse?: UploadedFileDto;
}

export interface UploadedFileDto {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  versionId: string;
  uploadedAt: Date;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly activeUploadsByUser = new Map<string, number>();

  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRepository: Repository<FileRecord>,
    @InjectRepository(Folder)
    private readonly folderRepository: Repository<Folder>,
    @InjectRepository(FileVersion)
    private readonly versionRepository: Repository<FileVersion>,
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly billingService: BillingService,
    private readonly crypto: FilesCryptoService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  /**
   * Creates the personal Drive and tenant storage metadata. IAM passes its manager
   * so these writes commit or roll back with account registration.
   */
  async getOrCreateUserDrive(
    organizationId: string,
    userId: string,
    transactionManager?: EntityManager,
  ): Promise<{ id: string; name: string; rootFolderId: string }> {
    if (transactionManager) {
      return this.ensureUserDrive(transactionManager, organizationId, userId);
    }
    return this.dataSource.transaction((manager) =>
      this.ensureUserDrive(manager, organizationId, userId),
    );
  }

  /**
   * SPEC-202: lista archivos y carpetas eliminados del Drive del solicitante.
   */
  async listTrash(organizationId: string, userId: string): Promise<TrashResponseDto> {
    const drive = await this.findPersonalDrive(organizationId, userId);

    if (!drive) {
      return { items: [], totalItems: 0 };
    }

    // 2. Archivos borrados lógicamente del Drive del solicitante, con su versión vigente en la misma consulta
    const [files, fileCount] = (await this.fileRepository
      .createQueryBuilder('file')
      .innerJoin('file.folder', 'folder')
      .leftJoinAndMapOne('file.currentVersion', FileVersion, 'version', 'version.id = file.currentVersionId')
      .where('file.organizationId = :organizationId', { organizationId })
      .andWhere('folder.driveId = :driveId', { driveId: drive.id })
      .andWhere('folder.isDeleted = false')
      .andWhere('file.isDeleted = :isDeleted', { isDeleted: true })
      .andWhere('file.deletedAt IS NOT NULL')
      .orderBy('file.deletedAt', 'DESC')
      .addOrderBy('file.id', 'ASC')
      .take(500)
      .getManyAndCount()) as [Array<FileRecord & { currentVersion: FileVersion | null }>, number];

    // 3. Mapear DTOs calculando retentionEndsAt (deletedAt + 30 días)
    const fileItems: TrashItemDto[] = files.map((file) => {
      const deletedDate = new Date(file.deletedAt as Date);
      const retentionDate = new Date(deletedDate.getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);

      const sizeNum = file.currentVersion?.sizeBytes ? Number(file.currentVersion.sizeBytes) : 0;

      return {
        kind: 'file' as const,
        id: file.id,
        name: file.name,
        mimeType: file.mimeType || 'application/octet-stream',
        sizeBytes: sizeNum,
        deletedAt: deletedDate.toISOString(),
        retentionEndsAt: retentionDate.toISOString(),
      };
    });

    const folderRows = await this.dataSource.query<Array<{
      id: string;
      name: string;
      parentFolderId: string;
      sizeBytes: string;
      deletedAt: Date | string;
    }>>(
      `WITH RECURSIVE roots AS (
        SELECT folder.folder_id, folder.parent_folder_id, folder.name, folder.deleted_at
        FROM files.folder folder
        LEFT JOIN files.folder parent
          ON parent.organization_id = folder.organization_id
          AND parent.folder_id = folder.parent_folder_id
        WHERE folder.organization_id = $1
          AND folder.drive_id = $2
          AND folder.is_deleted = true
          AND folder.deleted_at IS NOT NULL
          AND folder.parent_folder_id IS NOT NULL
          AND (parent.folder_id IS NULL OR parent.is_deleted = false)
      ),
      tree AS (
        SELECT root.folder_id AS root_id, root.folder_id AS folder_id
        FROM roots root
        UNION ALL
        SELECT tree.root_id, child.folder_id
        FROM tree
        INNER JOIN files.folder child
          ON child.parent_folder_id = tree.folder_id
        WHERE child.organization_id = $1
          AND child.drive_id = $2
      )
      SELECT root.folder_id AS id,
        root.name,
        root.parent_folder_id AS "parentFolderId",
        COALESCE(SUM(version.size_bytes), 0)::text AS "sizeBytes",
        root.deleted_at AS "deletedAt"
      FROM roots root
      INNER JOIN tree ON tree.root_id = root.folder_id
      LEFT JOIN files.file file ON file.folder_id = tree.folder_id
      LEFT JOIN files.file_version version ON version.version_id = file.current_version_id
      GROUP BY root.folder_id, root.parent_folder_id, root.name, root.deleted_at
      ORDER BY root.deleted_at DESC, root.folder_id ASC
      LIMIT 500`,
      [organizationId, drive.id],
    );
    const folderItems: TrashItemDto[] = folderRows.map((folder) => {
      const deletedDate = new Date(folder.deletedAt);
      return {
        kind: 'folder',
        id: folder.id,
        name: folder.name,
        parentFolderId: folder.parentFolderId,
        sizeBytes: Number(folder.sizeBytes),
        deletedAt: deletedDate.toISOString(),
        retentionEndsAt: new Date(deletedDate.getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      };
    });

    const items = [...fileItems, ...folderItems].sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
    return {
      items,
      totalItems: fileCount + folderItems.length,
    };
  }

  /**
   * Drive personal del solicitante. No lo crea: las lecturas y acciones sobre la papelera no escriben.
   */
  private async findPersonalDrive(
    organizationId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<Drive | null> {
    const driveRepo = (manager ?? this.dataSource).getRepository(Drive);
    return driveRepo.findOne({
      where: { organizationId, ownerUserId: userId, teamId: IsNull(), type: 'personal' },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Localiza un archivo de la organización y comprueba que su carpeta pertenece al Drive indicado.
   * No filtra por estado de papelera: cada operación decide qué hacer con él.
   */
  private async locateOwnFile(
    manager: EntityManager,
    fileId: string,
    organizationId: string,
    driveId: string,
    lock = false,
  ): Promise<{ file: FileRecord; folder: Folder } | null> {
    const file = await manager.getRepository(FileRecord).findOne({
      where: { id: fileId, organizationId },
      lock: lock ? { mode: 'pessimistic_write' } : undefined,
    });
    if (!file) return null;

    const folder = await manager.getRepository(Folder).findOne({
      where: { id: file.folderId, organizationId },
    });
    if (!folder || folder.driveId !== driveId) return null;
    return { file, folder };
  }

  /** Error de regla de negocio con la misma forma que STORAGE_QUOTA_EXCEEDED. */
  private businessError(status: HttpStatus, code: string, message: string): HttpException {
    return new HttpException(
      { statusCode: status, error: HttpStatus[status] ?? 'Error', code, message },
      status,
    );
  }

  private async ensureUserDrive(
    manager: EntityManager,
    organizationId: string,
    userId: string,
  ): Promise<{ id: string; name: string; rootFolderId: string }> {
    const driveRepo = manager.getRepository(Drive);
    const folderRepo = manager.getRepository(Folder);
    let drive = await driveRepo.findOne({
      where: { organizationId, ownerUserId: userId, teamId: IsNull(), type: 'personal' },
      order: { createdAt: 'ASC' },
    });
    if (!drive) {
      drive = await driveRepo.save(driveRepo.create({
        organizationId,
        ownerUserId: userId,
        teamId: null,
        name: 'Mi espacio',
        type: 'personal',
      }));
    }

    const { destination } = await this.ensureTenantResources(manager, organizationId);
    let rootFolder = await folderRepo.findOne({
      where: {
        organizationId,
        driveId: drive.id,
        parentId: IsNull(),
        isDeleted: false,
      },
    });
    if (!rootFolder) {
      rootFolder = await folderRepo.save(folderRepo.create({
        organizationId,
        driveId: drive.id,
        parentId: null,
        destinationId: destination.id,
        name: 'Archivos',
        createdBy: userId,
        isDeleted: false,
        deletedAt: null,
      }));
    }

    return { id: drive.id, name: drive.name, rootFolderId: rootFolder.id };
  }

  private async ensureTenantResources(
    manager: EntityManager,
    organizationId: string,
  ): Promise<{ destination: Destination; key: TenantEncryptionKey }> {
    const destinationRepo = manager.getRepository(Destination);
    const keyRepo = manager.getRepository(TenantEncryptionKey);
    const quotaRepo = manager.getRepository(TenantQuota);

    let destination = await destinationRepo.findOne({
      where: { organizationId, isDefault: true, isEnabled: true },
    });
    if (!destination) {
      destination = await destinationRepo.save(destinationRepo.create({
        organizationId,
        providerType: 's3',
        connectionStatus: 'Sin comprobar',
        isEnabled: true,
        isDefault: true,
        bucketOrPrefix: this.storageService.bucketName + '/' + organizationId,
        connectionDetailsEncrypted: this.crypto.encryptConnectionDetails(
          organizationId,
          JSON.stringify({
            endpoint: 'environment:S3_ENDPOINT',
            credentials: 'environment:S3_ACCESS_KEY,S3_SECRET_KEY',
            bucket: 'environment:S3_BUCKET',
          }),
        ),
      }));
    }

    let key = await keyRepo.findOne({
      where: { organizationId, status: 'active' },
      order: { createdAt: 'DESC' },
    });
    if (!key) {
      key = await keyRepo.save(keyRepo.create({
        organizationId,
        externalReference: this.crypto.externalKeyReference(organizationId),
        status: 'active',
        rotatedAt: null,
      }));
    }

    if (!(await quotaRepo.findOneBy({ organizationId }))) {
      await quotaRepo.save(quotaRepo.create({
        organizationId,
        confirmedUsageBytes: '0',
        activeReservationsBytes: '0',
      }));
    }

    return { destination, key };
  }

  private async calculateFolderSizes(
    organizationId: string,
    folderIds: string[],
  ): Promise<Map<string, number>> {
    const folderSizes = new Map<string, number>();
    if (!folderIds || folderIds.length === 0) return folderSizes;

    const sizeRows = await this.dataSource.query(
      `WITH RECURSIVE folder_tree AS (
        SELECT folder_id, folder_id AS root_folder_id
        FROM files.folder
        WHERE organization_id = $1 AND is_deleted = false AND folder_id = ANY($2)
        UNION
        SELECT f.folder_id, ft.root_folder_id
        FROM files.folder f
        JOIN folder_tree ft ON f.parent_folder_id = ft.folder_id
        WHERE f.organization_id = $1 AND f.is_deleted = false
      )
      SELECT
        ft.root_folder_id AS "folderId",
        COALESCE(SUM(v.size_bytes), 0)::text AS "totalSizeBytes"
      FROM folder_tree ft
      LEFT JOIN files.file f ON f.folder_id = ft.folder_id AND f.is_deleted = false
      LEFT JOIN files.file_version v ON v.version_id = f.current_version_id
      GROUP BY ft.root_folder_id`,
      [organizationId, folderIds],
    );
    for (const row of sizeRows) {
      folderSizes.set(row.folderId, Number(row.totalSizeBytes));
    }
    return folderSizes;
  }

  async listFolders(
    organizationId: string,
    userId: string,
    parentId?: string,
  ): Promise<{
    drive: { id: string; name: string; rootFolderId: string };
    items: Array<{ id: string; name: string; parentFolderId: string | null; driveId: string; createdAt: Date; sizeBytes: number }>;
  }> {
    const drive = await this.getOrCreateUserDrive(organizationId, userId);
    const effectiveParentId = parentId || drive.rootFolderId;
    await this.requirePersonalFolder(organizationId, drive.id, effectiveParentId);

    const folders = await this.folderRepository.find({
      where: {
        organizationId,
        driveId: drive.id,
        parentId: effectiveParentId,
        isDeleted: false,
      },
      order: { name: 'ASC' },
    });

    const folderIds = folders.map((folder) => folder.id);
    const folderSizes = await this.calculateFolderSizes(organizationId, folderIds);

    return {
      drive,
      items: folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentFolderId: folder.parentId,
        driveId: folder.driveId,
        createdAt: folder.createdAt,
        sizeBytes: folderSizes.get(folder.id) ?? 0,
      })),
    };
  }

  async createFolder(
    organizationId: string,
    userId: string,
    name: string,
    parentId?: string,
  ): Promise<{
    id: string;
    name: string;
    parentFolderId: string | null;
    driveId: string;
    createdAt: Date;
  }> {
    const normalizedName = name?.trim();
    if (!normalizedName || normalizedName.length > 255) {
      throw new BadRequestException('El nombre de carpeta debe tener entre 1 y 255 caracteres');
    }

    return this.dataSource.transaction(async (manager) => {
      await this.lockTenantQuota(manager, organizationId);
      const drive = await this.ensureUserDrive(manager, organizationId, userId);
      const parentFolder = await this.requirePersonalFolder(
        organizationId,
        drive.id,
        parentId || drive.rootFolderId,
        manager,
      );
      const folderRepo = manager.getRepository(Folder);
      const saved = await folderRepo.save(folderRepo.create({
        organizationId,
        driveId: drive.id,
        parentId: parentFolder.id,
        destinationId: parentFolder.destinationId,
        name: normalizedName,
        createdBy: userId,
        isDeleted: false,
        deletedAt: null,
      }));
      return {
        id: saved.id,
        name: saved.name,
        parentFolderId: saved.parentId,
        driveId: saved.driveId,
        createdAt: saved.createdAt,
      };
    });
  }

  async getFolderItems(
    organizationId: string,
    userId: string,
    folderId: string,
  ): Promise<{
    folder: { id: string; name: string; parentFolderId: string | null; driveId: string; createdAt: Date; sizeBytes: number };
    folders: Array<{ id: string; name: string; parentFolderId: string | null; driveId: string; createdAt: Date; sizeBytes: number }>;
    files: UploadedFileDto[];
  }> {
    const drive = await this.getOrCreateUserDrive(organizationId, userId);
    const folder = await this.requirePersonalFolder(organizationId, drive.id, folderId);
    const [folders, files] = await Promise.all([
      this.folderRepository.find({
        where: { organizationId, driveId: drive.id, parentId: folder.id, isDeleted: false },
        order: { name: 'ASC' },
      }),
      this.fileRepository.find({
        where: { organizationId, folderId: folder.id, isDeleted: false },
        relations: { versions: true },
        order: { name: 'ASC' },
      }),
    ]);

    const folderIds = [folder.id, ...folders.map((f) => f.id)];
    const folderSizes = await this.calculateFolderSizes(organizationId, folderIds);

    return {
      folder: {
        id: folder.id,
        name: folder.name,
        parentFolderId: folder.parentId,
        driveId: folder.driveId,
        createdAt: folder.createdAt,
        sizeBytes: folderSizes.get(folder.id) ?? 0,
      },
      folders: folders.map((item) => ({
        id: item.id,
        name: item.name,
        parentFolderId: item.parentId,
        driveId: item.driveId,
        createdAt: item.createdAt,
        sizeBytes: folderSizes.get(item.id) ?? 0,
      })),
      files: files.map((file) => this.toUploadedFileDto(file, file.versions ?? [])),
    };
  }

  async listFiles(
    organizationId: string,
    userId: string,
    folderId?: string,
  ): Promise<UploadedFileDto[]> {
    const drive = await this.getOrCreateUserDrive(organizationId, userId);
    const effectiveFolderId = folderId || drive.rootFolderId;
    await this.requirePersonalFolder(organizationId, drive.id, effectiveFolderId);
    const files = await this.fileRepository.find({
      where: { organizationId, folderId: effectiveFolderId, isDeleted: false },
      relations: { versions: true },
      order: { createdAt: 'DESC' },
    });
    return files.map((file) => this.toUploadedFileDto(file, file.versions ?? []));
  }

  private toUploadedFileDto(file: FileRecord, versions: FileVersion[]): UploadedFileDto {
    const current = versions.find((version) => version.id === file.currentVersionId)
      ?? versions.reduce<FileVersion | undefined>(
        (latest, version) => !latest || version.versionNumber > latest.versionNumber ? version : latest,
        undefined,
      );
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType || 'application/octet-stream',
      sizeBytes: Number(current?.sizeBytes ?? 0),
      versionId: current?.id ?? '',
      uploadedAt: current?.uploadedAt ?? file.createdAt,
    };
  }

  async getUsedStorageBytes(organizationId: string, manager?: EntityManager): Promise<bigint> {
    const executor = manager ?? this.dataSource.manager;
    const rows = await executor.query(
      'SELECT COALESCE(SUM(version.size_bytes), 0)::text AS "usedBytes" ' +
      'FROM files.file_version version ' +
      'INNER JOIN files.file file ON file.file_id = version.file_id ' +
      'WHERE file.organization_id = $1 ' +
      `AND (file.is_deleted = false OR file.deleted_at > now() - interval '${TRASH_RETENTION_DAYS} days')`,
      [organizationId],
    );
    return BigInt(rows[0]?.usedBytes ?? 0);
  }

  async getTotalStorageUsage(
    organizationId: string,
    manager?: EntityManager,
  ): Promise<StorageUsage> {
    if (manager) {
      await this.lockTenantQuota(manager, organizationId);
      await this.expireStaleReservations(manager, organizationId);
      const usage = await this.readStorageUsage(manager, organizationId);
      await this.writeQuotaCounters(manager, organizationId, usage);
      return usage;
    }
    return this.dataSource.transaction((tx) => this.getTotalStorageUsage(organizationId, tx));
  }

  private async readStorageUsage(manager: EntityManager, organizationId: string): Promise<StorageUsage> {
    const usedRows = await manager.query(
      'SELECT COALESCE(SUM(version.size_bytes), 0)::text AS total ' +
      'FROM files.file_version version ' +
      'INNER JOIN files.file file ON file.file_id = version.file_id ' +
      'WHERE file.organization_id = $1 ' +
      `AND (file.is_deleted = false OR file.deleted_at > now() - interval '${TRASH_RETENTION_DAYS} days')`,
      [organizationId],
    );
    const reservedRows = await manager.query(
      "SELECT COALESCE(SUM(size_bytes), 0)::text AS total FROM files.reservation " +
      "WHERE organization_id = $1 AND status = 'active' AND expires_at > now()",
      [organizationId],
    );
    const usedBytes = BigInt(usedRows[0]?.total ?? 0);
    const reservedBytes = BigInt(reservedRows[0]?.total ?? 0);
    return { usedBytes, reservedBytes, totalBytes: usedBytes + reservedBytes };
  }

  private async lockTenantQuota(manager: EntityManager, organizationId: string): Promise<void> {
    await manager.query(
      'INSERT INTO files.tenant_quota (organization_id) VALUES ($1) ' +
      'ON CONFLICT (organization_id) DO NOTHING',
      [organizationId],
    );
    await manager.query(
      'SELECT organization_id FROM files.tenant_quota WHERE organization_id = $1 FOR UPDATE',
      [organizationId],
    );
  }

  private async expireStaleReservations(manager: EntityManager, organizationId: string): Promise<void> {
    await manager.query(
      "UPDATE files.reservation SET status = 'expired' " +
      "WHERE organization_id = $1 AND status = 'active' AND expires_at <= now()",
      [organizationId],
    );
  }

  private async writeQuotaCounters(
    manager: EntityManager,
    organizationId: string,
    usage: StorageUsage,
  ): Promise<void> {
    await manager.query(
      'UPDATE files.tenant_quota SET confirmed_usage_bytes = $2, ' +
      'active_reservations_bytes = $3, updated_at = now() WHERE organization_id = $1',
      [organizationId, usage.usedBytes.toString(), usage.reservedBytes.toString()],
    );
  }

  private async requirePersonalFolder(
    organizationId: string,
    driveId: string,
    folderId: string,
    manager?: EntityManager,
    lock = false,
  ): Promise<Folder> {
    const folderRepo = manager?.getRepository(Folder) ?? this.folderRepository;
    const folder = await folderRepo.findOne({
      where: { id: folderId, organizationId, driveId, isDeleted: false },
      ...(lock && manager ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!folder) throw new NotFoundException('Carpeta ' + folderId + ' no encontrada');
    return folder;
  }

  async uploadMultipartFile(params: {
    organizationId: string;
    ownerId: string;
    folderId: string;
    file: any;
    idempotencyKey?: string;
  }): Promise<UploadedFileDto> {
    const { organizationId, ownerId, folderId, file } = params;
    if (!folderId) throw new BadRequestException('El parámetro folderId es obligatorio');
    if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
      throw new UnsupportedMediaTypeException('El archivo multipart no contiene datos válidos');
    }
    const currentActive = this.activeUploadsByUser.get(ownerId) ?? 0;
    if (currentActive >= MAX_ACTIVE_UPLOADS_PER_USER) {
      throw new HttpException(
        'Límite de tres cargas simultáneas alcanzado para este usuario',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.activeUploadsByUser.set(ownerId, currentActive + 1);

    try {
      const originalName = this.normalizeFileName(file.originalname);
      const bytes: Buffer = file.buffer;
      const fileSize = bytes.length;
      if (fileSize > MAX_FILE_SIZE_BYTES) {
        throw new PayloadTooLargeException('El archivo excede el máximo de 100000000 bytes');
      }
      const extension = this.fileExtension(originalName);
      const mimeType = String(file.mimetype ?? '').toLowerCase();
      if (!ALLOWED_MIME_BY_EXT[extension]?.includes(mimeType) || !this.hasExpectedContent(extension, bytes)) {
        throw new UnsupportedMediaTypeException(
          'El contenido del archivo no coincide con un formato permitido (PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT o ZIP)',
        );
      }

      const drive = await this.getOrCreateUserDrive(organizationId, ownerId);
      await this.requirePersonalFolder(organizationId, drive.id, folderId);
      const reservation = await this.reserveUpload({
        organizationId,
        ownerId,
        folderId,
        name: originalName,
        sizeBytes: fileSize,
        idempotencyKey: this.normalizeIdempotencyKey(params.idempotencyKey),
      });
      if (reservation.existingResponse) return reservation.existingResponse;

      let objectKey: string | undefined;
      try {
        const uploaded = await this.dataSource.transaction(async (manager) => {
          await this.lockTenantQuota(manager, organizationId);
          const folder = await this.requirePersonalFolder(
            organizationId,
            drive.id,
            folderId,
            manager,
            true,
          );
          const fileRepo = manager.getRepository(FileRecord);
          const versionRepo = manager.getRepository(FileVersion);
          const uploadRepo = manager.getRepository(Upload);
          const reservationRepo = manager.getRepository(Reservation);

          let fileRecord = await fileRepo.findOne({
            where: { organizationId, folderId: folder.id, name: originalName, isDeleted: false },
          });
          if (!fileRecord) {
            fileRecord = await fileRepo.save(fileRepo.create({
              organizationId,
              folderId: folder.id,
              name: originalName,
              mimeType,
              currentVersionId: null,
              isDeleted: false,
              deletedAt: null,
              createdBy: ownerId,
            }));
          }

          const latest = await versionRepo.findOne({
            where: { fileId: fileRecord.id },
            order: { versionNumber: 'DESC' },
          });
          const versionNumber = (latest?.versionNumber ?? 0) + 1;
          const encrypted: EncryptedFile = this.crypto.encryptFile(
            organizationId,
            fileRecord.id,
            versionNumber,
            bytes,
          );
          const generatedObjectKey = organizationId + '/' + fileRecord.id + '/v' + versionNumber + '/' + randomUUID();
          objectKey = generatedObjectKey;

          const { destination, key } = await this.ensureTenantResources(manager, organizationId);
          await this.storageService.put(
            generatedObjectKey,
            encrypted.bytes,
            encrypted.bytes.length,
            'application/octet-stream',
          );

          const savedVersion = await versionRepo.save(versionRepo.create({
            fileId: fileRecord.id,
            versionNumber,
            destinationId: folder.destinationId ?? destination.id,
            objectKey: generatedObjectKey,
            sizeBytes: String(fileSize),
            checksum: encrypted.checksum,
            encryptedDek: encrypted.encryptedDek,
            kekId: key.id,
            formatVersion: encrypted.formatVersion,
            uploadedBy: ownerId,
          }));
          fileRecord.mimeType = mimeType;
          fileRecord.currentVersionId = savedVersion.id;
          await fileRepo.save(fileRecord);

          const reservationRow = await reservationRepo.findOne({
            where: { id: reservation.reservationId, organizationId, status: 'active' },
            lock: { mode: 'pessimistic_write' },
          });
          if (!reservationRow) {
            throw new ConflictException('La reserva de cuota de la carga ya no está activa');
          }
          reservationRow.status = 'released';
          await reservationRepo.save(reservationRow);

          const uploadRow = await uploadRepo.findOneBy({
            id: reservation.uploadId,
            organizationId,
          });
          if (!uploadRow) throw new InternalServerErrorException('No se encontró el registro de carga');
          uploadRow.status = 'Disponible';
          uploadRow.receivedSizeBytes = String(fileSize);
          uploadRow.destinationId = folder.destinationId ?? destination.id;
          uploadRow.objectKey = generatedObjectKey;
          await uploadRepo.save(uploadRow);

          const usage = await this.readStorageUsage(manager, organizationId);
          await this.writeQuotaCounters(manager, organizationId, usage);
          return {
            id: fileRecord.id,
            name: fileRecord.name,
            mimeType: fileRecord.mimeType ?? mimeType,
            sizeBytes: Number(fileSize),
            versionId: savedVersion.id,
            uploadedAt: savedVersion.uploadedAt,
          };
        });

        // Enganche SPEC-405: FILE_UPLOAD posterior al commit exitoso
        void this.auditService?.logEvent({
          organizationId,
          actorId: ownerId,
          action: AuditAction.FILE_UPLOAD,
          resourceType: AuditResource.FILE,
          resourceId: uploaded.id,
        }).catch(() => {});

        return uploaded;
      } catch (error) {
        const objectDeleted = objectKey
          ? await this.storageService.delete(objectKey).then(() => true).catch((deleteError) => {
              this.logger.error('No se pudo limpiar objeto ' + objectKey + ': ' + String(deleteError));
              return false;
            })
          : true;
        await this.finishFailedUpload(organizationId, reservation, objectKey, objectDeleted);
        if (error instanceof HttpException) throw error;
        this.logger.error('Falló la carga de archivos: ' + String(error));
        throw new InternalServerErrorException('No se pudo completar la carga del archivo');
      }
    } finally {
      this.decrementActiveUploads(ownerId);
    }
  }

  private async reserveUpload(params: {
    organizationId: string;
    ownerId: string;
    folderId: string;
    name: string;
    sizeBytes: number;
    idempotencyKey: string;
  }): Promise<UploadReservation> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockTenantQuota(manager, params.organizationId);
      await this.expireStaleReservations(manager, params.organizationId);

      const uploadRepo = manager.getRepository(Upload);
      const existing = await uploadRepo.findOne({
        where: { organizationId: params.organizationId, idempotencyKey: params.idempotencyKey },
      });
      if (existing) {
        if (existing.createdBy !== params.ownerId || existing.folderId !== params.folderId) {
          throw new ConflictException('La Idempotency-Key ya fue usada para otra solicitud');
        }
        if (existing.status === 'Disponible' && existing.objectKey) {
          const version = await manager.getRepository(FileVersion).findOne({
            where: { objectKey: existing.objectKey },
          });
          const savedFile = version
            ? await manager.getRepository(FileRecord).findOne({
                where: { id: version.fileId, organizationId: params.organizationId },
              })
            : null;
          if (version && savedFile) {
            return {
              uploadId: existing.id,
              reservationId: existing.reservationId,
              existingResponse: {
                id: savedFile.id,
                name: savedFile.name,
                mimeType: savedFile.mimeType ?? 'application/octet-stream',
                sizeBytes: Number(version.sizeBytes),
                versionId: version.id,
                uploadedAt: version.uploadedAt,
              },
            };
          }
          throw new ConflictException('La operación idempotente ya no está disponible');
        }
        if (existing.status !== 'Fallida') {
          throw new ConflictException('La solicitud con esta Idempotency-Key sigue en proceso');
        }
      }

      const usage = await this.readStorageUsage(manager, params.organizationId);
      const limit = await this.billingService.getStorageLimitBytes(params.organizationId);
      if (usage.totalBytes + BigInt(params.sizeBytes) > limit) {
        throw new HttpException(
          {
            statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
            error: 'Unprocessable Entity',
            code: 'STORAGE_QUOTA_EXCEEDED',
            message: 'La carga excede la cuota disponible para el plan de la organización',
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const { destination } = await this.ensureTenantResources(manager, params.organizationId);
      const reservationRepo = manager.getRepository(Reservation);
      const reservation = await reservationRepo.save(reservationRepo.create({
        organizationId: params.organizationId,
        sizeBytes: String(params.sizeBytes),
        status: 'active',
        expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
      }));

      const upload = existing ?? uploadRepo.create();
      upload.organizationId = params.organizationId;
      upload.folderId = params.folderId;
      upload.idempotencyKey = params.idempotencyKey;
      upload.declaredName = params.name;
      upload.declaredSizeBytes = String(params.sizeBytes);
      upload.receivedSizeBytes = null;
      upload.status = 'Pendiente';
      upload.reservationId = reservation.id;
      upload.destinationId = destination.id;
      upload.objectKey = null;
      upload.createdBy = params.ownerId;
      const savedUpload = await uploadRepo.save(upload);

      const updatedUsage = {
        usedBytes: usage.usedBytes,
        reservedBytes: usage.reservedBytes + BigInt(params.sizeBytes),
        totalBytes: usage.totalBytes + BigInt(params.sizeBytes),
      };
      await this.writeQuotaCounters(manager, params.organizationId, updatedUsage);
      return { uploadId: savedUpload.id, reservationId: reservation.id };
    });
  }

  private async finishFailedUpload(
    organizationId: string,
    reservationInfo: UploadReservation,
    objectKey: string | undefined,
    objectDeleted: boolean,
  ): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.lockTenantQuota(manager, organizationId);
        const reservationRepo = manager.getRepository(Reservation);
        const reservation = await reservationRepo.findOne({
          where: { id: reservationInfo.reservationId, organizationId },
          lock: { mode: 'pessimistic_write' },
        });
        if (reservation && objectDeleted) reservation.status = 'released';
        if (reservation && !objectDeleted) {
          reservation.expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
        }
        if (reservation) await reservationRepo.save(reservation);

        const uploadRepo = manager.getRepository(Upload);
        const upload = await uploadRepo.findOneBy({ id: reservationInfo.uploadId, organizationId });
        if (upload) {
          upload.status = objectDeleted ? 'Fallida' : 'Limpieza pendiente';
          upload.objectKey = objectKey ?? null;
          await uploadRepo.save(upload);
        }

        const usage = await this.readStorageUsage(manager, organizationId);
        await this.writeQuotaCounters(manager, organizationId, usage);
      });
    } catch (error) {
      this.logger.error('No se pudo cerrar la reserva ' + reservationInfo.uploadId + ': ' + String(error));
    }
  }

  private normalizeFileName(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException('El archivo debe tener un nombre válido');
    }
    const normalized = value.replace(/\\/g, '/').split('/').pop()!
      .replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!normalized || normalized.length > 255 || normalized === '.' || normalized === '..') {
      throw new BadRequestException('El nombre del archivo no es válido');
    }
    return normalized;
  }

  private fileExtension(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot < 0 ? '' : name.slice(dot).toLowerCase();
  }

  private normalizeIdempotencyKey(value?: string): string {
    if (value === undefined || value === '') return randomUUID();
    const normalized = value.trim();
    if (!normalized || normalized.length > 255) {
      throw new BadRequestException('Idempotency-Key debe tener entre 1 y 255 caracteres');
    }
    return normalized;
  }

  private hasExpectedContent(extension: string, bytes: Buffer): boolean {
    if (extension === '.pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
    if (extension === '.jpg' || extension === '.jpeg') {
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }
    if (extension === '.png') {
      return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (extension === '.txt') {
      if (bytes.includes(0)) return false;
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return true;
      } catch {
        return false;
      }
    }
    if (extension === '.zip') return this.isZip(bytes);
    if (extension === '.docx') return this.isOfficeZip(bytes, 'word/document.xml');
    if (extension === '.xlsx') return this.isOfficeZip(bytes, 'xl/workbook.xml');
    if (extension === '.pptx') return this.isOfficeZip(bytes, 'ppt/presentation.xml');
    return false;
  }

  private isZip(bytes: Buffer): boolean {
    return bytes.length >= 4
      && bytes[0] === 0x50
      && bytes[1] === 0x4b
      && [0x03, 0x05, 0x07].includes(bytes[2])
      && [0x04, 0x06, 0x08].includes(bytes[3]);
  }

  private isOfficeZip(bytes: Buffer, expectedFile: string): boolean {
    if (!this.isZip(bytes)) return false;
    const minOffset = Math.max(0, bytes.length - 65_557);
    let endOffset = -1;
    for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
      if (bytes.readUInt32LE(offset) === 0x06054b50) {
        endOffset = offset;
        break;
      }
    }
    if (endOffset < 0) return false;

    const entryCount = bytes.readUInt16LE(endOffset + 10);
    let cursor = bytes.readUInt32LE(endOffset + 16);
    const names = new Set<string>();
    for (let index = 0; index < entryCount && cursor + 46 <= bytes.length; index += 1) {
      if (bytes.readUInt32LE(cursor) !== 0x02014b50) return false;
      const nameLength = bytes.readUInt16LE(cursor + 28);
      const extraLength = bytes.readUInt16LE(cursor + 30);
      const commentLength = bytes.readUInt16LE(cursor + 32);
      const nameStart = cursor + 46;
      names.add(bytes.subarray(nameStart, nameStart + nameLength).toString('utf8'));
      cursor = nameStart + nameLength + extraLength + commentLength;
    }
    return names.has('[Content_Types].xml') && names.has(expectedFile);
  }

  private decrementActiveUploads(userId: string): void {
    const current = this.activeUploadsByUser.get(userId) ?? 1;
    if (current <= 1) this.activeUploadsByUser.delete(userId);
    else this.activeUploadsByUser.set(userId, current - 1);
  }

  async downloadFileStream(
    fileId: string,
    organizationId: string,
    userId: string,
  ): Promise<{ stream: Readable; mimeType: string; name: string }> {
    const drive = await this.getOrCreateUserDrive(organizationId, userId);
    const file = await this.fileRepository.createQueryBuilder('file')
      .innerJoin('file.folder', 'folder')
      .where('file.id = :fileId', { fileId })
      .andWhere('file.organizationId = :organizationId', { organizationId })
      .andWhere('file.isDeleted = false')
      .andWhere('folder.driveId = :driveId', { driveId: drive.id })
      .andWhere('folder.isDeleted = false')
      .getOne();
    if (!file || !file.currentVersionId) {
      throw new NotFoundException('Archivo ' + fileId + ' no encontrado');
    }

    const version = await this.versionRepository.findOne({
      where: { id: file.currentVersionId, fileId: file.id },
    });
    if (!version) throw new NotFoundException('Versión no encontrada para el archivo ' + fileId);

    try {
      const objectStream = await this.storageService.get(version.objectKey);
      const objectBytes = await this.readStream(objectStream);
      const plaintext = this.crypto.decryptFile(
        organizationId,
        file.id,
        version.versionNumber,
        version.encryptedDek,
        version.checksum,
        objectBytes,
      );
      return {
        stream: Readable.from([plaintext]),
        mimeType: file.mimeType || 'application/octet-stream',
        name: file.name,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('No se pudo leer el archivo ' + fileId + ': ' + String(error));
      throw new InternalServerErrorException('No se pudo recuperar el archivo');
    }
  }

  private async readStream(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async softDelete(fileId: string, organizationId: string, userId: string): Promise<FileRecord> {
    const drive = await this.getOrCreateUserDrive(organizationId, userId);
    const file = await this.fileRepository.createQueryBuilder('file')
      .innerJoin('file.folder', 'folder')
      .where('file.id = :fileId', { fileId })
      .andWhere('file.organizationId = :organizationId', { organizationId })
      .andWhere('file.isDeleted = false')
      .andWhere('folder.driveId = :driveId', { driveId: drive.id })
      .andWhere('folder.isDeleted = false')
      .getOne();
    if (!file) throw new NotFoundException('Archivo ' + fileId + ' no encontrado');

    file.isDeleted = true;
    file.deletedAt = new Date();
    const saved = await this.fileRepository.save(file);

    // Enganche SPEC-405: FILE_DELETE tras guardar el borrado lógico
    void this.auditService?.logEvent({
      organizationId,
      actorId: userId,
      action: AuditAction.FILE_DELETE,
      resourceType: AuditResource.FILE,
      resourceId: saved.id,
    }).catch(() => {});

    return saved;
  }

  /** Mueve una carpeta y todo su árbol de contenido a la papelera como una unidad restaurable. */
  async softDeleteFolder(folderId: string, organizationId: string, userId: string): Promise<{ success: true; id: string }> {
    const drive = await this.findPersonalDrive(organizationId, userId);
    if (!drive) throw new NotFoundException('Carpeta ' + folderId + ' no encontrada');

    await this.dataSource.transaction(async (manager) => {
      await this.lockTenantQuota(manager, organizationId);
      const folderRepo = manager.getRepository(Folder);
      const root = await folderRepo.findOne({
        where: { id: folderId, organizationId, driveId: drive.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!root || root.isDeleted || !root.parentId) {
        throw new NotFoundException('Carpeta ' + folderId + ' no encontrada');
      }

      const tree = await this.getFolderTree(manager, folderId, organizationId, drive.id);
      const folderIds = tree.map((folder) => folder.id);
      const deletedAt = new Date();
      await manager.query(
        'UPDATE files.folder SET is_deleted = true, deleted_at = $3 ' +
        'WHERE organization_id = $1 AND folder_id = ANY($2::uuid[]) AND is_deleted = false',
        [organizationId, folderIds, deletedAt],
      );
      await manager.query(
        'UPDATE files.file SET is_deleted = true, deleted_at = $3 ' +
        'WHERE organization_id = $1 AND folder_id = ANY($2::uuid[]) AND is_deleted = false',
        [organizationId, folderIds, deletedAt],
      );
    });

    return { success: true, id: folderId };
  }

  /** Restaura la unidad de carpeta; archivos previamente eliminados individualmente permanecen en la papelera. */
  async restoreFolder(folderId: string, organizationId: string, userId: string): Promise<RestoreFolderResponseDto> {
    const drive = await this.findPersonalDrive(organizationId, userId);
    if (!drive) throw new NotFoundException('Carpeta ' + folderId + ' no encontrada');

    return this.dataSource.transaction(async (manager) => {
      await this.lockTenantQuota(manager, organizationId);
      const folderRepo = manager.getRepository(Folder);
      const root = await folderRepo.findOne({
        where: { id: folderId, organizationId, driveId: drive.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!root || !root.isDeleted || !root.deletedAt || !root.parentId) {
        throw new NotFoundException('Carpeta ' + folderId + ' no encontrada en la papelera');
      }

      const tree = await this.getFolderTree(manager, folderId, organizationId, drive.id);
      const folderIds = tree.map((folder) => folder.id);
      const parent = await folderRepo.findOne({
        where: { id: root.parentId, organizationId, driveId: drive.id },
      });
      if (!parent || parent.isDeleted) {
        throw this.businessError(HttpStatus.CONFLICT, 'PARENT_FOLDER_UNAVAILABLE', 'La carpeta contenedora no está disponible');
      }

      const nameTaken = await folderRepo.exists({
        where: { organizationId, driveId: drive.id, parentId: root.parentId, name: root.name, isDeleted: false },
      });
      if (nameTaken) {
        throw this.businessError(HttpStatus.CONFLICT, 'FOLDER_NAME_CONFLICT', 'Ya existe una carpeta con ese nombre');
      }

      const expiredBytesRows = await manager.query<Array<{ total: string }>>(
        'SELECT COALESCE(SUM(version.size_bytes), 0)::text AS total ' +
        'FROM files.file file INNER JOIN files.file_version version ON version.file_id = file.file_id ' +
        'WHERE file.organization_id = $1 AND file.folder_id = ANY($2::uuid[]) ' +
        'AND file.is_deleted = true AND file.deleted_at = $3 ' +
        `AND file.deleted_at <= now() - interval '${TRASH_RETENTION_DAYS} days'`,
        [organizationId, folderIds, root.deletedAt],
      );
      const expiredBytes = BigInt(expiredBytesRows[0]?.total ?? 0);
      if (expiredBytes > 0n) {
        const usage = await this.readStorageUsage(manager, organizationId);
        const limit = await this.billingService.getStorageLimitBytes(organizationId);
        if (usage.totalBytes + expiredBytes > limit) {
          throw this.businessError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'STORAGE_QUOTA_EXCEEDED',
            'La restauración excede la cuota disponible para el plan de la organización',
          );
        }
      }

      await manager.query(
        'UPDATE files.folder SET is_deleted = false, deleted_at = NULL ' +
        'WHERE organization_id = $1 AND folder_id = ANY($2::uuid[]) AND deleted_at = $3',
        [organizationId, folderIds, root.deletedAt],
      );
      await manager.query(
        'UPDATE files.file SET is_deleted = false, deleted_at = NULL ' +
        'WHERE organization_id = $1 AND folder_id = ANY($2::uuid[]) AND is_deleted = true AND deleted_at = $3',
        [organizationId, folderIds, root.deletedAt],
      );

      const usage = await this.readStorageUsage(manager, organizationId);
      await this.writeQuotaCounters(manager, organizationId, usage);
      return { id: root.id, name: root.name, parentFolderId: root.parentId };
    });
  }

  /** Purga una carpeta con todo su contenido y elimina los objetos tras confirmar la transacción. */
  async purgeFolder(folderId: string, organizationId: string, userId: string): Promise<PurgeFileResponseDto> {
    const drive = await this.findPersonalDrive(organizationId, userId);
    if (!drive) throw new NotFoundException('Carpeta ' + folderId + ' no encontrada');

    const purged = await this.dataSource.transaction(async (manager) => {
      await this.lockTenantQuota(manager, organizationId);
      const folderRepo = manager.getRepository(Folder);
      const root = await folderRepo.findOne({
        where: { id: folderId, organizationId, driveId: drive.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!root || !root.isDeleted || !root.parentId) {
        throw new NotFoundException('Carpeta ' + folderId + ' no encontrada en la papelera');
      }

      const tree = await this.getFolderTree(manager, folderId, organizationId, drive.id);
      const folderIds = tree.map((folder) => folder.id);
      const files = await manager.getRepository(FileRecord).find({
        where: { organizationId, folderId: In(folderIds) },
      });
      const fileIds = files.map((file) => file.id);
      const versions = fileIds.length
        ? await manager.getRepository(FileVersion).find({ where: { fileId: In(fileIds) } })
        : [];
      const freedBytes = versions.reduce((total, version) => total + BigInt(version.sizeBytes), 0n);

      for (const fileId of fileIds) await this.removeFileRows(manager, fileId);
      for (const folder of tree) await folderRepo.delete({ id: folder.id, organizationId });

      const usage = await this.readStorageUsage(manager, organizationId);
      await this.writeQuotaCounters(manager, organizationId, usage);
      return { freedBytes, objectKeys: versions.map((version) => version.objectKey) };
    });

    void this.deleteOrphanObjects(purged.objectKeys);
    return { id: folderId, freedBytes: Number(purged.freedBytes) };
  }

  private getFolderTree(
    manager: EntityManager,
    folderId: string,
    organizationId: string,
    driveId: string,
  ): Promise<FolderTreeRow[]> {
    return manager.query<FolderTreeRow[]>(
      `WITH RECURSIVE folder_tree AS (
        SELECT folder_id AS id, name, parent_folder_id AS "parentFolderId", 0 AS depth, deleted_at AS "deletedAt"
        FROM files.folder
        WHERE folder_id = $1 AND organization_id = $2 AND drive_id = $3
        UNION ALL
        SELECT child.folder_id, child.name, child.parent_folder_id, tree.depth + 1, child.deleted_at
        FROM files.folder child
        INNER JOIN folder_tree tree ON child.parent_folder_id = tree.id
        WHERE child.organization_id = $2 AND child.drive_id = $3
      )
      SELECT id, name, "parentFolderId", depth, "deletedAt"
      FROM folder_tree
      ORDER BY depth DESC, id ASC`,
      [folderId, organizationId, driveId],
    );
  }

  /**
   * SPEC-203: devuelve un archivo de la papelera del solicitante a su carpeta original.
   */
  async restoreFile(fileId: string, organizationId: string, userId: string): Promise<RestoreFileResponseDto> {
    const drive = await this.findPersonalDrive(organizationId, userId);
    if (!drive) throw new NotFoundException('Archivo ' + fileId + ' no encontrado');

    const restored = await this.dataSource.transaction((manager) =>
      this.applyRestore(manager, fileId, organizationId, drive.id),
    );

    // Enganche SPEC-405: FILE_RESTORE tras el commit
    void this.auditService?.logEvent({
      organizationId,
      actorId: userId,
      action: AuditAction.FILE_RESTORE,
      resourceType: AuditResource.FILE,
      resourceId: fileId,
    }).catch(() => {});

    return restored;
  }

  private async applyRestore(
    manager: EntityManager,
    fileId: string,
    organizationId: string,
    driveId: string,
  ): Promise<RestoreFileResponseDto> {
    // Serializa con las cargas de la organización (mismo lock que uploadMultipartFile)
    await this.lockTenantQuota(manager, organizationId);
    const located = await this.locateOwnFile(manager, fileId, organizationId, driveId, true);
    if (!located || !located.file.isDeleted) {
      throw new NotFoundException('Archivo ' + fileId + ' no encontrado');
    }

    const { file, folder } = located;
    if (folder.isDeleted) {
      throw this.businessError(HttpStatus.CONFLICT, 'PARENT_FOLDER_UNAVAILABLE', 'La carpeta original ya no está disponible');
    }

    const fileRepo = manager.getRepository(FileRecord);
    const nameTaken = await fileRepo.exists({
      where: { organizationId, folderId: file.folderId, name: file.name, isDeleted: false },
    });
    if (nameTaken) {
      throw this.businessError(HttpStatus.CONFLICT, 'FILE_NAME_CONFLICT', 'Ya existe un archivo con ese nombre en la carpeta');
    }

    await this.assertRestoreFitsQuota(manager, file, organizationId);

    // Ambos campos a la vez: el CHECK ck_file_soft_delete_consistent lo exige
    file.isDeleted = false;
    file.deletedAt = null;
    const saved = await fileRepo.save(file);
    return { id: saved.id, name: saved.name, folderId: saved.folderId };
  }

  /**
   * Un archivo eliminado hace más de 30 días ya no cuenta para la cuota (readStorageUsage).
   * Restaurarlo lo vuelve a contar, así que debe caber en el límite del plan, igual que una carga.
   * Si todavía está dentro de la retención ya cuenta, y no se vuelve a comprobar.
   */
  private async assertRestoreFitsQuota(manager: EntityManager, file: FileRecord, organizationId: string): Promise<void> {
    const retentionCutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    if (!file.deletedAt || file.deletedAt.getTime() > retentionCutoff) return;

    const version = file.currentVersionId
      ? await manager.getRepository(FileVersion).findOne({ where: { id: file.currentVersionId, fileId: file.id } })
      : null;
    const sizeBytes = BigInt(version?.sizeBytes ?? 0);
    const usage = await this.readStorageUsage(manager, organizationId);
    const limit = await this.billingService.getStorageLimitBytes(organizationId);
    if (usage.totalBytes + sizeBytes > limit) {
      throw this.businessError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'STORAGE_QUOTA_EXCEEDED',
        'La restauración excede la cuota disponible para el plan de la organización',
      );
    }
  }

  /**
   * SPEC-204: purga definitiva de un archivo de la papelera del solicitante.
   * Los objetos de SeaweedFS se borran después del commit, con mejor esfuerzo y sin bloquear la respuesta.
   */
  async purgeFile(fileId: string, organizationId: string, userId: string): Promise<PurgeFileResponseDto> {
    const drive = await this.findPersonalDrive(organizationId, userId);
    if (!drive) throw new NotFoundException('Archivo ' + fileId + ' no encontrado');

    const purged = await this.dataSource.transaction((manager) =>
      this.applyPurge(manager, fileId, organizationId, drive.id),
    );

    // Enganche SPEC-405: FILE_PURGE tras el commit
    void this.auditService?.logEvent({
      organizationId,
      actorId: userId,
      action: AuditAction.FILE_PURGE,
      resourceType: AuditResource.FILE,
      resourceId: fileId,
    }).catch(() => {});

    // No se espera al borrado de objetos: la purga ya está confirmada y SeaweedFS no debe bloquear la respuesta
    void this.deleteOrphanObjects(purged.objectKeys);
    return { id: fileId, freedBytes: Number(purged.freedBytes) };
  }

  private async applyPurge(
    manager: EntityManager,
    fileId: string,
    organizationId: string,
    driveId: string,
  ): Promise<{ freedBytes: bigint; objectKeys: string[] }> {
    await this.lockTenantQuota(manager, organizationId);
    const located = await this.locateOwnFile(manager, fileId, organizationId, driveId, true);
    if (!located) throw new NotFoundException('Archivo ' + fileId + ' no encontrado');
    if (!located.file.isDeleted) {
      throw this.businessError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'CANNOT_PURGE_ACTIVE_FILE',
        'Solo se puede purgar un archivo que está en la papelera',
      );
    }

    const versions = await manager.getRepository(FileVersion).find({ where: { fileId } });
    const freedBytes = versions.reduce((total, version) => total + BigInt(version.sizeBytes), BigInt(0));

    await this.removeFileRows(manager, fileId);
    const usage = await this.readStorageUsage(manager, organizationId);
    await this.writeQuotaCounters(manager, organizationId, usage);
    return { freedBytes, objectKeys: versions.map((version) => version.objectKey) };
  }

  /**
   * Orden obligatorio: fk_file_current_version es RESTRICT, así que la versión vigente
   * se desvincula antes de borrar las versiones, y estas antes que el archivo.
   */
  private async removeFileRows(manager: EntityManager, fileId: string): Promise<void> {
    const fileRepo = manager.getRepository(FileRecord);
    await fileRepo.update({ id: fileId }, { currentVersionId: null });
    await manager.getRepository(FileVersion).delete({ fileId });
    await fileRepo.delete({ id: fileId });
  }

  /** Borrado de objetos con mejor esfuerzo. Un fallo se registra con su clave; nunca revierte la purga. */
  private async deleteOrphanObjects(objectKeys: string[]): Promise<void> {
    const results = await Promise.allSettled(objectKeys.map((key) => this.storageService.delete(key)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error('Objeto huérfano tras purga: ' + objectKeys[index]);
      }
    });
  }
}
