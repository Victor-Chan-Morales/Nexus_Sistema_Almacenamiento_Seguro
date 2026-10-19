import { Injectable, Inject, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
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
 * Implementa put / get / delete sobre un proveedor compatible con S3 (SeaweedFS).
 * El patrón Strategy permite intercambiar el proveedor de almacenamiento
 * sin modificar FilesModule (Principio Open/Closed — SOLID).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly bucket: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject('S3_CLIENT') private readonly s3Client: any,
    @Inject('S3_PUBLIC_CLIENT') private readonly s3PublicClient: any,
    private readonly config: ConfigService,
  ) {
    this.bucket = this.config.get<string>('S3_BUCKET', 'nexus-dev');
  }

  get bucketName(): string {
    return this.bucket;
  }

  /**
   * Guarda un objeto en el almacenamiento S3 / SeaweedFS.
   * @param objectKey   Clave única del objeto (incluye prefijo de org)
   * @param stream      Stream o buffer con los bytes del archivo
   * @param size        Tamaño en bytes (-1 si desconocido)
   * @param contentType MIME type del archivo
   */
  async put(
    objectKey: string,
    stream: any,
    size: number,
    contentType: string,
  ): Promise<void> {
    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: stream,
          ...(size >= 0 ? { ContentLength: size } : {}),
          ContentType: contentType,
        }),
      );
    } catch (err: any) {
      this.logger.error(`No se pudo guardar el objeto en Storage: ${err?.message || err}`);
      throw new InternalServerErrorException('Error al guardar el objeto en Storage');
    }
  }

  /**
   * Devuelve un stream de lectura del objeto almacenado.
   */
  async get(objectKey: string): Promise<Readable> {
    try {
      const result = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        }),
      );
      return result.Body as Readable;
    } catch (err: any) {
      this.logger.error(`No se pudo recuperar el objeto de Storage: ${err?.message || err}`);
      throw new InternalServerErrorException('Error al recuperar el objeto de Storage');
    }
  }

  /**
   * Elimina un objeto del almacenamiento.
   */
  async delete(objectKey: string): Promise<void> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        }),
      );
    } catch (err: any) {
      this.logger.error(`No se pudo eliminar el objeto de Storage: ${err?.message || err}`);
      throw new InternalServerErrorException('Error al eliminar el objeto de Storage');
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
    } catch (err: any) {
      throw new InternalServerErrorException(
        `Error al generar URL prefirmada: ${err?.message || err}`,
      );
    }
  }

  /**
   * Verifica que el bucket existe; si no, lo crea automáticamente.
   * Ejecutado en el ciclo de vida onModuleInit.
   */
  async ensureBucket(): Promise<void> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err: any) {
      const missingBucket =
        err?.$metadata?.httpStatusCode === 404 ||
        err?.name === 'NotFound' ||
        err?.name === 'NoSuchBucket';

      if (!missingBucket) {
        throw err;
      }

      await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }
}
