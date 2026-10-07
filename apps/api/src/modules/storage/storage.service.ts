import { Injectable, Inject, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';

/**
 * StorageService — contrato de almacenamiento de objetos.
 *
 * Implementa put / get / delete sobre MinIO.
 * El patrón Strategy permite agregar S3 u otro proveedor
 * sin modificar FilesModule (Principio Open/Closed — SOLID).
 */
@Injectable()
export class StorageService {
  private readonly bucket: string;

  constructor(
    @Inject('MINIO_CLIENT') private readonly minioClient: any,
    private readonly config: ConfigService,
  ) {
    this.bucket = this.config.get<string>('MINIO_BUCKET', 'nexus-dev');
  }

  /**
   * Guarda un objeto en MinIO.
   * @param objectKey   Clave única del objeto (incluye prefijo de org)
   * @param stream      Stream con los bytes del archivo
   * @param size        Tamaño en bytes (-1 si desconocido)
   * @param contentType MIME type del archivo
   */
  async put(
    objectKey: string,
    stream: Readable,
    size: number,
    contentType: string,
  ): Promise<void> {
    try {
      await this.minioClient.putObject(
        this.bucket,
        objectKey,
        stream,
        size,
        { 'Content-Type': contentType },
      );
    } catch (err) {
      throw new InternalServerErrorException(`Error al guardar el objeto: ${err.message}`);
    }
  }

  /**
   * Devuelve un stream de lectura del objeto almacenado.
   */
  async get(objectKey: string): Promise<Readable> {
    try {
      return await this.minioClient.getObject(this.bucket, objectKey);
    } catch (err) {
      throw new InternalServerErrorException(`Error al obtener el objeto: ${err.message}`);
    }
  }

  /**
   * Elimina un objeto del almacenamiento.
   */
  async delete(objectKey: string): Promise<void> {
    try {
      await this.minioClient.removeObject(this.bucket, objectKey);
    } catch (err) {
      throw new InternalServerErrorException(`Error al eliminar el objeto: ${err.message}`);
    }
  }

  /**
   * Genera una URL prefirmada temporal para descarga directa.
   * @param objectKey Clave del objeto
   * @param expirySeconds Tiempo de validez en segundos (por defecto 1 hora)
   */
  async getPresignedUrl(objectKey: string, expirySeconds = 3600): Promise<string> {
    try {
      return await this.minioClient.presignedGetObject(
        this.bucket,
        objectKey,
        expirySeconds,
      );
    } catch (err) {
      throw new InternalServerErrorException(`Error al generar URL prefirmada: ${err.message}`);
    }
  }

  /**
   * Verifica que el bucket existe; si no, lo crea.
   * Llamado al iniciar la aplicación.
   */
  async ensureBucket(): Promise<void> {
    const exists = await this.minioClient.bucketExists(this.bucket);
    if (!exists) {
      await this.minioClient.makeBucket(this.bucket, 'us-east-1');
    }
  }
}
