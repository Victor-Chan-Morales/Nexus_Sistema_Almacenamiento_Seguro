import { Injectable, Inject, InternalServerErrorException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ObjectStorage, S3ObjectStorage } from './object-storage';

/**
 * StorageService — destino de entorno (SPEC-801).
 *
 * Usa la configuración S3_* (SeaweedFS hoy) y es el almacén que StorageRouter devuelve
 * para todo destino cuyas credenciales son referencias `environment:*`.
 * SPEC-802 añadirá los destinos con credenciales propias, sin cambiar esta clase.
 */
@Injectable()
export class StorageService implements ObjectStorage, OnModuleInit {
  private readonly bucket: string;
  private readonly objects: S3ObjectStorage;

  constructor(
    @Inject('S3_CLIENT') private readonly s3Client: any,
    @Inject('S3_PUBLIC_CLIENT') private readonly s3PublicClient: any,
    private readonly config: ConfigService,
  ) {
    this.bucket = this.config.get<string>('S3_BUCKET', 'nexus-dev');
    this.objects = new S3ObjectStorage(this.s3Client, this.bucket);
  }

  get bucketName(): string {
    return this.bucket;
  }

  /** Guarda un objeto en el bucket de entorno. */
  put(objectKey: string, body: Buffer, size: number, contentType: string): Promise<void> {
    return this.objects.put(objectKey, body, size, contentType);
  }

  /** Devuelve un stream de lectura del objeto del bucket de entorno. */
  get(objectKey: string): Promise<Readable> {
    return this.objects.get(objectKey);
  }

  /** Elimina un objeto del bucket de entorno. */
  delete(objectKey: string): Promise<void> {
    return this.objects.delete(objectKey);
  }

  /**
   * Genera una URL prefirmada temporal para descarga directa.
   * Se conserva sin uso en la interfaz (SPEC-801, fuera de alcance).
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
