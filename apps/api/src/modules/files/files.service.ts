import { Injectable, Inject, Logger } from '@nestjs/common';
import { STORAGE_PROVIDER, StorageProvider } from './storage/storage.provider';
import { Readable } from 'stream';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  // Inyectamos el StorageProvider sin importar MinIO directamente (Arquitectura SOLID)
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /**
   * Lógica para subir un archivo.
   * Por ahora es la estructura base. Más adelante lo conectaremos con la BD.
   */
  async uploadFile(fileInfo: any, fileStream: Buffer | Readable, organizationId: string): Promise<any> {
    this.logger.log(`Iniciando subida de archivo para org: ${organizationId}`);
    
    // 1. Generar un nombre seguro para MinIO (Ej: orgId/año/mes/uuid.ext)
    const uniqueId = crypto.randomUUID();
    const objectKey = `${organizationId}/${uniqueId}-${fileInfo.originalname}`;

    // 2. Subir el archivo físicamente a MinIO
    await this.storage.uploadFile(objectKey, fileStream, fileInfo.mimetype);

    // 3. (Pendiente) Registrar en PostgreSQL y validar cuotas
    
    // 4. Retornar los metadatos como exige el contrato
    return {
      id: uniqueId, // Esto será el ID de la base de datos luego
      name: fileInfo.originalname,
      mimeType: fileInfo.mimetype,
      sizeBytes: fileInfo.size,
      versionId: "v1",
      uploadedAt: new Date().toISOString(),
    };
  }
}