import { Readable } from 'stream';

export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';

export interface StorageProvider {
  /**
   * Sube un archivo físico al almacenamiento de objetos.
   */
  uploadFile(objectKey: string, data: Buffer | Readable, mimeType: string): Promise<void>;

  /**
   * Obtiene un flujo de lectura de un archivo físico existente.
   */
  getFileStream(objectKey: string): Promise<Readable>;

  /**
   * Elimina un archivo físico del almacenamiento (usado para rollback si la BD falla).
   */
  deleteFile(objectKey: string): Promise<void>;
}