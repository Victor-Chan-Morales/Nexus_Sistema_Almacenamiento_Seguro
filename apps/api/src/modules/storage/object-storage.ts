import { InternalServerErrorException, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Contrato de almacenamiento de objetos de un destino (SPEC-801).
 * FilesService solo conoce esta interfaz; el proveedor concreto lo decide StorageRouter.
 */
export interface ObjectStorage {
  put(objectKey: string, body: Buffer, size: number, contentType: string): Promise<void>;
  get(objectKey: string): Promise<Readable>;
  delete(objectKey: string): Promise<void>;
}

/** Subconjunto del cliente S3 que usa la implementación. Permite simularlo en pruebas. */
export interface S3Sender {
  send(command: unknown): Promise<any>;
}

/**
 * Implementación de ObjectStorage sobre un bucket S3 (SeaweedFS, MinIO o AWS S3).
 * Traduce cualquier fallo del proveedor a un error genérico, sin exponer credenciales.
 */
export class S3ObjectStorage implements ObjectStorage {
  private readonly logger = new Logger(S3ObjectStorage.name);

  constructor(
    private readonly s3Client: S3Sender,
    private readonly bucket: string,
  ) {}

  /**
   * @param size Tamaño en bytes; si es negativo, S3 lo calcula.
   */
  async put(objectKey: string, body: Buffer, size: number, contentType: string): Promise<void> {
    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: body,
          ...(size >= 0 ? { ContentLength: size } : {}),
          ContentType: contentType,
        }),
      );
    } catch (err: any) {
      this.logger.error(`No se pudo guardar el objeto en Storage: ${err?.message || err}`);
      throw new InternalServerErrorException('Error al guardar el objeto en Storage');
    }
  }

  async get(objectKey: string): Promise<Readable> {
    try {
      const result = await this.s3Client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return result.Body as Readable;
    } catch (err: any) {
      this.logger.error(`No se pudo recuperar el objeto de Storage: ${err?.message || err}`);
      throw new InternalServerErrorException('Error al recuperar el objeto de Storage');
    }
  }

  async delete(objectKey: string): Promise<void> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
    } catch (err: any) {
      this.logger.error(`No se pudo eliminar el objeto de Storage: ${err?.message || err}`);
      throw new InternalServerErrorException('Error al eliminar el objeto de Storage');
    }
  }
}
