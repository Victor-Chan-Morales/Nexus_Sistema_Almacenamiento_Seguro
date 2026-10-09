import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { StorageProvider } from './storage.provider';
import { Readable } from 'stream';

@Injectable()
export class MinioStorageService implements StorageProvider {
  private readonly logger = new Logger(MinioStorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName = process.env.STORAGE_BUCKET_NAME || 'nexus-files';

  constructor() {
    this.s3Client = new S3Client({
      endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
      region: process.env.MINIO_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.MINIO_ROOT_USER || 'nexus_local',
        secretAccessKey: process.env.MINIO_ROOT_PASSWORD || 'local_only_change_me_please',
      },
      forcePathStyle: true, // Obligatorio para que funcione con MinIO local
    });
  }

  async uploadFile(objectKey: string, data: Buffer | Readable, mimeType: string): Promise<void> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
        Body: data,
        ContentType: mimeType,
      });
      await this.s3Client.send(command);
      this.logger.debug(`[Upload Success] Objeto guardado en MinIO: ${objectKey}`);
    } catch (error: any) {
      this.logger.error(`[Upload Error] Fallo al escribir objeto: ${objectKey}`, error.stack);
      throw error; 
    }
  }

  async getFileStream(objectKey: string): Promise<Readable> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
      });
      const response = await this.s3Client.send(command);
      return response.Body as Readable;
    } catch (error: any) {
      this.logger.error(`[Download Error] No se pudo obtener el objeto: ${objectKey}`, error.stack);
      throw error;
    }
  }

  async deleteFile(objectKey: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
      });
      await this.s3Client.send(command);
      this.logger.debug(`[Delete Success] Objeto eliminado de MinIO (compensación): ${objectKey}`);
    } catch (error) {
      this.logger.warn(`[Delete Warning] Fallo al intentar eliminar objeto huérfano: ${objectKey}`);
    }
  }
}