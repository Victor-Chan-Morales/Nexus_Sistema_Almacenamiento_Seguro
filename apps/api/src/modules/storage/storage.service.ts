import { Injectable, Inject, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * StorageService — contrato de almacenamiento de objetos.
 *
 * Implementa put / get / delete sobre un proveedor compatible con S3.
 * El patrón Strategy permite agregar S3 u otro proveedor
 * sin modificar FilesModule (Principio Open/Closed — SOLID).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly bucket: string;

  constructor(
    @Inject('S3_CLIENT') private readonly s3Client: any,
    @Inject('S3_PUBLIC_CLIENT') private readonly s3PublicClient: any,
    private readonly config: ConfigService,
  ) {
    this.bucket = this.config.get<string>('S3_BUCKET', 'nexus-dev');
  }

  /**
   * Guarda un objeto en el almacenamiento S3.
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
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: stream,
        ...(size >= 0 ? { ContentLength: size } : {}),
        ContentType: contentType,
      }));
    } catch (err) {
      throw new InternalServerErrorException(`Error al guardar el objeto: ${err.message}`);
    }
  }

  /**
   * Devuelve un stream de lectura del objeto almacenado.
   */
  async get(objectKey: string): Promise<Readable> {
    try {
      const result = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }));
      return result.Body as Readable;
    } catch (err) {
      throw new InternalServerErrorException(`Error al obtener el objeto: ${err.message}`);
    }
  }

  /**
   * Elimina un objeto del almacenamiento.
   */
  async delete(objectKey: string): Promise<void> {
    try {
      await this.s3Client.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }));
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
      return await getSignedUrl(
        this.s3PublicClient,
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
        { expiresIn: expirySeconds },
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
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const missingBucket = error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound';
      if (!missingBucket) throw error;
      await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }
}
