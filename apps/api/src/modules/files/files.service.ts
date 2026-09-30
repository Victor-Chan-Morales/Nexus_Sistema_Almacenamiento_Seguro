import { Injectable, Inject, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { STORAGE_PROVIDER, StorageProvider } from './storage/storage.provider';
import { DatabaseService } from './database.service';
import { Readable } from 'stream';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  // Valores MOCK extraídos del seed de Sebastián para el MVP
  private readonly MOCK_USER_ID = '00000000-0000-0000-0000-0000000000e1';
  private readonly MOCK_DESTINATION_ID = '00000000-0000-0000-0000-0000000000c1';
  private readonly MOCK_KEK_ID = '00000000-0000-0000-0000-0000000000d1';
  private readonly QUOTA_LIMIT_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly db: DatabaseService, // Inyectamos la base de datos nativa
  ) {}

  // 1. Crear Drive inicial
  async createDrive(name: string, organizationId: string) {
    const res = await this.db.query(
      `INSERT INTO files.drive (organization_id, type, owner_user_id, name) 
       VALUES ($1, 'personal', $2, $3) RETURNING *`,
      [organizationId, this.MOCK_USER_ID, name]
    );
    return res.rows[0];
  }

  // 2. Crear Carpeta
  async createFolder(name: string, driveId: string, organizationId: string, parentFolderId?: string) {
    const res = await this.db.query(
      `INSERT INTO files.folder (organization_id, drive_id, parent_folder_id, name, created_by) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [organizationId, driveId, parentFolderId || null, name, this.MOCK_USER_ID]
    );
    return res.rows[0];
  }

  // 3. Subir Archivo Completo (Validación, Storage, Transacción BD)
  async uploadFile(fileInfo: any, fileStream: Buffer | Readable, folderId: string, organizationId: string) {
    this.logger.log(`Validando cuota para org: ${organizationId}`);

    // A. Validar Cuota (Límite 5 GB)
    const quotaRes = await this.db.query(
      `SELECT confirmed_usage_bytes + active_reservations_bytes AS total_used 
       FROM files.tenant_quota WHERE organization_id = $1`,
      [organizationId]
    );
    
    const currentUsage = quotaRes.rows.length > 0 ? Number(quotaRes.rows[0].total_used) : 0;
    if (currentUsage + fileInfo.size > this.QUOTA_LIMIT_BYTES) {
      throw new BadRequestException('Cuota de almacenamiento excedida (Límite 5GB)');
    }

    // B. Subir a MinIO
    const uniqueId = crypto.randomUUID();
    const objectKey = `${organizationId}/${uniqueId}-${fileInfo.originalname}`;
    await this.storage.uploadFile(objectKey, fileStream, fileInfo.mimetype);

    // C. Guardar Metadatos en PostgreSQL mediante Transacción
    return this.db.transaction(async (client: any) => {
      // Insertar el registro lógico del archivo
      const fileRes = await client.query(
        `INSERT INTO files.file (organization_id, folder_id, name, mime_type, created_by) 
         VALUES ($1, $2, $3, $4, $5) RETURNING file_id`,
        [organizationId, folderId, fileInfo.originalname, fileInfo.mimetype, this.MOCK_USER_ID]
      );
      const fileId = fileRes.rows[0].file_id;

      // Insertar la versión del archivo
      const versionRes = await client.query(
        `INSERT INTO files.file_version 
        (file_id, version_number, destination_id, object_key, size_bytes, checksum, encrypted_dek, kek_id, format_version, uploaded_by) 
        VALUES ($1, 1, $2, $3, $4, $5, $6, $7, 1, $8) RETURNING version_id`,
        [
          fileId, 
          this.MOCK_DESTINATION_ID, 
          objectKey, 
          fileInfo.size, 
          'checksum-pendiente-mvp', // Mock MVP
          'dek-pendiente-mvp', // Mock MVP
          this.MOCK_KEK_ID, 
          this.MOCK_USER_ID
        ]
      );
      const versionId = versionRes.rows[0].version_id;

      // Enlazar la versión actual al archivo
      await client.query(
        `UPDATE files.file SET current_version_id = $1 WHERE file_id = $2`,
        [versionId, fileId]
      );

      // Descontar la cuota
      await client.query(
        `UPDATE files.tenant_quota SET confirmed_usage_bytes = confirmed_usage_bytes + $1 WHERE organization_id = $2`,
        [fileInfo.size, organizationId]
      );

      this.logger.log(`Archivo ${fileId} guardado con éxito.`);
      
      return {
        id: fileId,
        versionId: versionId,
        name: fileInfo.originalname,
        sizeBytes: fileInfo.size
      };
    });
  }

  // 4. Descargar Archivo (Aislamiento por Organización)
  async downloadFile(fileId: string, organizationId: string) {
    // Validamos que el archivo exista y pertenezca a la organización que lo solicita
    const query = `
      SELECT fv.object_key, f.name, f.mime_type 
      FROM files.file f 
      JOIN files.file_version fv ON f.current_version_id = fv.version_id 
      WHERE f.file_id = $1 AND f.organization_id = $2 AND f.is_deleted = false
    `;
    const res = await this.db.query(query, [fileId, organizationId]);

    if (res.rows.length === 0) {
      throw new ForbiddenException('Archivo no encontrado o no tienes permisos de organización.');
    }

    const { object_key, name, mime_type } = res.rows[0];
    
    // Suponiendo que tu StorageProvider tiene un método getFileStream
    // const stream = await this.storage.getFileStream(object_key);
    
    return {
      name,
      mimeType: mime_type,
      objectKey: object_key // Temporalmente devuelto hasta que implementes el stream de MinIO
    };
  }
}