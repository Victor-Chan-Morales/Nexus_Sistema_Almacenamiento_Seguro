import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomBytes, randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { Destination } from '../files/entities/destination.entity';
import { DestinationConnectionDetails, FilesCryptoService } from '../files/files-crypto.service';
import { ObjectStorage, S3ObjectStorage, S3Sender } from './object-storage';
import { StorageService } from './storage.service';

/** SPEC-802: causas seguras de un fallo de prueba de conexión. Nunca el mensaje crudo del SDK. */
export type ConnectionFailureReason = 'AUTH' | 'NETWORK' | 'BUCKET_NOT_FOUND' | 'DATA_MISMATCH';
export type ConnectionProbeResult = { ok: true } | { ok: false; reason: ConnectionFailureReason };

export const CONNECTION_PROBE_TIMEOUT_MS = 10_000;
const PROBE_PREFIX = '.nexus-connection-test/';

const AUTH_ERRORS = new Set([
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'AccessDenied',
  'InvalidToken',
  'ExpiredToken',
  'AccountProblem',
]);

class ProbeTimeoutError extends Error {
  constructor() {
    super('La prueba de conexión excedió su tiempo límite');
    this.name = 'TimeoutError';
  }
}

/**
 * Clasifica un fallo del SDK o de red en una categoría de SPEC-802. Lo no reconocido cuenta como red:
 * es lo más probable cuando el servidor no responde como S3.
 */
export function classifyProbeError(err: unknown): ConnectionFailureReason {
  const e = (err ?? {}) as { name?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  const status = e.$metadata?.httpStatusCode;
  if (e.name === 'NoSuchBucket' || status === 404) return 'BUCKET_NOT_FOUND';
  if (AUTH_ERRORS.has(e.name ?? '') || status === 401 || status === 403) return 'AUTH';
  return 'NETWORK';
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProbeTimeoutError()), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

async function readAll(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * SPEC-802 escenario 3: escribe un objeto de prueba, lo lee, compara su contenido y lo borra.
 * Todo el intento tiene un límite de tiempo. Si la escritura llegó a hacerse, intenta borrarlo aunque falle.
 */
export async function runConnectionProbe(
  client: S3Sender,
  bucket: string,
  timeoutMs = CONNECTION_PROBE_TIMEOUT_MS,
): Promise<ConnectionProbeResult> {
  const key = `${PROBE_PREFIX}${randomUUID()}`;
  const payload = randomBytes(32);
  let written = false;

  try {
    return await withTimeout(
      (async (): Promise<ConnectionProbeResult> => {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: payload,
            ContentLength: payload.length,
            ContentType: 'application/octet-stream',
          }),
        );
        written = true;
        const output = (await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))) as { Body?: unknown };
        const content = await readAll(output.Body);
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        written = false;
        return content.equals(payload) ? { ok: true } : { ok: false, reason: 'DATA_MISMATCH' };
      })(),
      timeoutMs,
    );
  } catch (err) {
    if (written) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
    }
    return { ok: false, reason: classifyProbeError(err) };
  }
}

/** Cliente S3 y bucket de un destino con credenciales propias. */
interface OwnTarget {
  ciphertext: string;
  client: S3Client;
  bucket: string;
}

/**
 * StorageRouter — elige el almacén de cada operación según el destino (SPEC-801 y SPEC-802).
 *
 * FilesService pide un ObjectStorage por destination_id y no conoce el proveedor.
 * Lectura y borrado admiten destinos deshabilitados; escritura exige uno habilitado.
 * Un destino de otra organización (o inexistente) responde 404 antes de tocar el almacén.
 * Un destino con credenciales propias usa su propio cliente S3; uno de entorno usa StorageService.
 */
@Injectable()
export class StorageRouter {
  /** Clientes de destinos propios, por destinationId. Se reutilizan mientras no cambie su configuración cifrada. */
  private readonly ownTargets = new Map<string, OwnTarget>();

  constructor(
    @InjectRepository(Destination)
    private readonly destinations: Repository<Destination>,
    private readonly environmentStorage: StorageService,
    private readonly crypto: FilesCryptoService,
    @Inject('S3_CLIENT') private readonly environmentClient: S3Sender,
  ) {}

  /** Bucket del destino de entorno. Lo usa FilesService al crear el destino predeterminado. */
  get defaultBucketName(): string {
    return this.environmentStorage.bucketName;
  }

  /** Almacén para leer o borrar objetos de un destino, esté habilitado o no. */
  async forRead(organizationId: string, destinationId: string): Promise<ObjectStorage> {
    const destination = await this.findDestination(organizationId, destinationId);
    return this.providerFor(destination);
  }

  /** Almacén para escribir: el destino debe estar habilitado. */
  async forWrite(organizationId: string, destinationId: string): Promise<ObjectStorage> {
    const destination = await this.findDestination(organizationId, destinationId);
    if (!destination.isEnabled) {
      throw new ConflictException('El destino de almacenamiento está deshabilitado');
    }
    return this.providerFor(destination);
  }

  /**
   * SPEC-802: prueba la conexión de un destino. Usa el mismo cliente que el de producción, de modo que la prueba
   * refleja lo que ocurrirá al guardar archivos. Devuelve solo el resultado y la causa segura, nunca el detalle del SDK.
   */
  async probe(organizationId: string, destinationId: string): Promise<ConnectionProbeResult> {
    const destination = await this.findDestination(organizationId, destinationId);
    const own = this.ownTargetFor(destination);
    const target = own ?? { client: this.environmentClient, bucket: this.environmentStorage.bucketName };
    return runConnectionProbe(target.client, target.bucket);
  }

  /**
   * Descarta el cliente cacheado de un destino. Lo llama el servicio de destinos después de cambiar sus credenciales.
   */
  invalidate(destinationId: string): void {
    this.ownTargets.delete(destinationId);
  }

  private async findDestination(organizationId: string, destinationId: string): Promise<Destination> {
    const destination = await this.destinations.findOne({
      where: { id: destinationId, organizationId },
    });
    if (!destination) {
      throw new NotFoundException('Destino de almacenamiento no encontrado');
    }
    return destination;
  }

  /** SPEC-801/802: destinos de entorno → StorageService; destinos con credenciales propias → su cliente S3. */
  private providerFor(destination: Destination): ObjectStorage {
    const own = this.ownTargetFor(destination);
    if (own === null) return this.environmentStorage;
    return new S3ObjectStorage(own.client, own.bucket);
  }

  /** Cliente de un destino propio, o null si su configuración es de entorno (`environment:*`). */
  private ownTargetFor(destination: Destination): OwnTarget | null {
    const cached = this.ownTargets.get(destination.id);
    if (cached && cached.ciphertext === destination.connectionDetailsEncrypted) return cached;

    const details = this.crypto.readDestinationDetails(destination.organizationId, destination.connectionDetailsEncrypted);
    if (details === null) return null;

    const target: OwnTarget = {
      ciphertext: destination.connectionDetailsEncrypted,
      client: this.createClient(details),
      bucket: details.bucket,
    };
    this.ownTargets.set(destination.id, target);
    return target;
  }

  private createClient(details: DestinationConnectionDetails): S3Client {
    // `useSsl` decide el protocolo; el host y el puerto son los que guardó el administrador.
    const url = new URL(details.endpoint);
    url.protocol = details.useSsl ? 'https:' : 'http:';
    return new S3Client({
      endpoint: url.toString(),
      region: details.region,
      forcePathStyle: true,
      credentials: { accessKeyId: details.accessKey, secretAccessKey: details.secretKey },
    });
  }
}
