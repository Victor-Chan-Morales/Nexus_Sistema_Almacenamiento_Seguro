import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { Destination } from '../files/entities/destination.entity';
import { FilesCryptoService } from '../files/files-crypto.service';
import { classifyProbeError, runConnectionProbe, StorageRouter } from './storage-router.service';
import { StorageService } from './storage.service';

jest.mock('@aws-sdk/client-s3', () => ({ ...jest.requireActual('@aws-sdk/client-s3'), S3Client: jest.fn() }));
const S3ClientMock = S3Client as unknown as jest.Mock;

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
const crypto = new FilesCryptoService(new ConfigService({ FILES_MASTER_KEY: MASTER_KEY }));

/** Configuración de entorno tal como la guarda FilesService: referencias cifradas, no credenciales. */
const ENVIRONMENT_CIPHERTEXT = crypto.encryptConnectionDetails(
  ORG,
  JSON.stringify({ endpoint: 'environment:S3_ENDPOINT', credentials: 'environment:S3_ACCESS_KEY,S3_SECRET_KEY', bucket: 'environment:S3_BUCKET' }),
);

/** Credenciales propias de un destino de cliente. */
const OWN_CIPHERTEXT = crypto.encryptConnectionDetails(
  ORG,
  JSON.stringify({
    endpoint: 'https://almacen.ejemplo.test:9000',
    bucket: 'cliente-a',
    region: 'eu-west-1',
    accessKey: 'AK-CLIENTE',
    secretKey: 'SK-CLIENTE',
    useSsl: true,
  }),
);

const destination = (overrides: Partial<Destination> = {}): Destination =>
  Object.assign(new Destination(), {
    id: 'dest-a',
    organizationId: ORG,
    providerType: 's3',
    isEnabled: true,
    isDefault: true,
    connectionDetailsEncrypted: ENVIRONMENT_CIPHERTEXT,
    ...overrides,
  });

/** Repositorio simulado: solo encuentra destinos de la organización indicada en `where`. */
const buildRouter = (rows: Destination[] = [destination()]) => {
  const findOne = jest.fn(async ({ where }: { where: { id: string; organizationId: string } }) =>
    rows.find((row) => row.id === where.id && row.organizationId === where.organizationId) ?? null,
  );
  const environment = {
    bucketName: 'nexus-dev',
    put: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const environmentClient = { send: jest.fn() };
  const router = new StorageRouter(
    { findOne } as never,
    environment as unknown as StorageService,
    crypto,
    environmentClient,
  );
  return { router, findOne, environment, environmentClient };
};

describe('SPEC-801: StorageRouter', () => {
  it('escenario 2: la lectura busca el destino por su destination_id dentro de la organización', async () => {
    const { router, findOne, environment } = buildRouter([
      destination({ id: 'dest-a' }),
      destination({ id: 'dest-b', isDefault: false }),
    ]);

    const storage = await router.forRead(ORG, 'dest-b');
    await storage.get('org-1/file-1/v1/uuid');

    expect(findOne).toHaveBeenCalledWith({ where: { id: 'dest-b', organizationId: ORG } });
    expect(environment.get).toHaveBeenCalledWith('org-1/file-1/v1/uuid');
  });

  it('escenario 2: versiones en dos destinos distintos consultan cada destino por separado', async () => {
    const { router, findOne } = buildRouter([
      destination({ id: 'dest-a' }),
      destination({ id: 'dest-b', isDefault: false }),
    ]);

    await router.forRead(ORG, 'dest-a');
    await router.forRead(ORG, 'dest-b');

    expect(findOne.mock.calls.map(([args]) => args.where.id)).toEqual(['dest-a', 'dest-b']);
  });

  it('escenario 4: un destino de otra organización falla con 404 sin tocar el almacén', async () => {
    const { router, environment } = buildRouter([destination({ id: 'dest-a', organizationId: OTHER_ORG })]);

    await expect(router.forRead(ORG, 'dest-a')).rejects.toBeInstanceOf(NotFoundException);
    await expect(router.forWrite(ORG, 'dest-a')).rejects.toBeInstanceOf(NotFoundException);
    expect(environment.get).not.toHaveBeenCalled();
    expect(environment.put).not.toHaveBeenCalled();
    expect(environment.delete).not.toHaveBeenCalled();
  });

  it('escenario 4: un destino inexistente también falla con 404 sin tocar el almacén', async () => {
    const { router, environment } = buildRouter([]);

    await expect(router.forRead(ORG, 'dest-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(environment.delete).not.toHaveBeenCalled();
  });

  it('escenario 4: un destino deshabilitado sigue permitiendo leer y borrar, pero no escribir', async () => {
    const { router, environment } = buildRouter([destination({ id: 'dest-a', isEnabled: false })]);

    const reader = await router.forRead(ORG, 'dest-a');
    await reader.delete('org-1/file-1/v1/uuid');
    expect(environment.delete).toHaveBeenCalledWith('org-1/file-1/v1/uuid');

    await expect(router.forWrite(ORG, 'dest-a')).rejects.toBeInstanceOf(ConflictException);
    await expect(router.forWrite(ORG, 'dest-a')).rejects.toMatchObject({
      response: { code: 'CONFLICT', message: 'El destino de almacenamiento está deshabilitado' },
    });
    expect(environment.put).not.toHaveBeenCalled();
  });

  it('forWrite entrega el almacén de un destino habilitado', async () => {
    const { router, environment } = buildRouter();

    const writer = await router.forWrite(ORG, 'dest-a');
    await writer.put('org-1/file-1/v1/uuid', Buffer.from('cifrado'), 7, 'application/octet-stream');

    expect(environment.put).toHaveBeenCalledWith('org-1/file-1/v1/uuid', Buffer.from('cifrado'), 7, 'application/octet-stream');
  });

  it('expone el bucket del destino de entorno', () => {
    const { router } = buildRouter();

    expect(router.defaultBucketName).toBe('nexus-dev');
  });
});

/** Almacén en memoria con la forma de un S3 real: guarda objetos y responde a Put, Get y Delete. */
const memoryS3 = () => {
  const objects = new Map<string, Buffer>();
  const putKeys: string[] = [];
  const send = jest.fn(async (command: unknown) => {
    if (command instanceof HeadBucketCommand) return {};
    if (command instanceof PutObjectCommand) {
      const key = command.input.Key as string;
      putKeys.push(key);
      objects.set(key, Buffer.from(command.input.Body as Buffer));
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const body = objects.get(command.input.Key as string);
      if (!body) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
      return { Body: Readable.from([body]) };
    }
    if (command instanceof DeleteObjectCommand) {
      objects.delete(command.input.Key as string);
      return {};
    }
    throw new Error('comando no esperado');
  });
  return { objects, putKeys, send };
};

const failingS3 = (error: Record<string, unknown>) => ({
  send: jest.fn(async () => {
    throw Object.assign(new Error('mensaje crudo del SDK con detalles internos'), error);
  }),
});

describe('SPEC-802: StorageRouter con credenciales propias', () => {
  beforeEach(() => {
    S3ClientMock.mockReset();
  });

  it('escenario 10: un destino con credenciales propias usa su propio cliente S3 y su bucket', async () => {
    const memory = memoryS3();
    S3ClientMock.mockImplementation(() => ({ send: memory.send }));
    const { router, environment } = buildRouter([destination({ id: 'dest-own', isDefault: false, connectionDetailsEncrypted: OWN_CIPHERTEXT })]);

    const storage = await router.forWrite(ORG, 'dest-own');
    await storage.put('org-1/file-1/v1/uuid', Buffer.from('cifrado'), 7, 'application/octet-stream');

    expect(S3ClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://almacen.ejemplo.test:9000/',
        region: 'eu-west-1',
        forcePathStyle: true,
        credentials: { accessKeyId: 'AK-CLIENTE', secretAccessKey: 'SK-CLIENTE' },
      }),
    );
    expect(memory.objects.get('org-1/file-1/v1/uuid')).toEqual(Buffer.from('cifrado'));
    expect(environment.put).not.toHaveBeenCalled();
  });

  it('escenario 10: un destino de entorno sigue usando StorageService y no crea clientes propios', async () => {
    const { router, environment } = buildRouter();

    const storage = await router.forRead(ORG, 'dest-a');
    await storage.get('org-1/file-1/v1/uuid');

    expect(environment.get).toHaveBeenCalledWith('org-1/file-1/v1/uuid');
    expect(S3ClientMock).not.toHaveBeenCalled();
  });

  it('reutiliza el cliente del destino mientras su configuración no cambie', async () => {
    S3ClientMock.mockImplementation(() => ({ send: jest.fn() }));
    const { router } = buildRouter([destination({ id: 'dest-own', isDefault: false, connectionDetailsEncrypted: OWN_CIPHERTEXT })]);

    await router.forRead(ORG, 'dest-own');
    await router.forRead(ORG, 'dest-own');

    expect(S3ClientMock).toHaveBeenCalledTimes(1);
  });

  it('invalidate descarta el cliente cacheado y el siguiente uso crea uno nuevo', async () => {
    S3ClientMock.mockImplementation(() => ({ send: jest.fn() }));
    const { router } = buildRouter([destination({ id: 'dest-own', isDefault: false, connectionDetailsEncrypted: OWN_CIPHERTEXT })]);

    await router.forRead(ORG, 'dest-own');
    router.invalidate('dest-own');
    await router.forRead(ORG, 'dest-own');

    expect(S3ClientMock).toHaveBeenCalledTimes(2);
  });

  it('si cambia la configuración cifrada, crea un cliente nuevo aunque no se haya invalidado', async () => {
    S3ClientMock.mockImplementation(() => ({ send: jest.fn() }));
    const row = destination({ id: 'dest-own', isDefault: false, connectionDetailsEncrypted: OWN_CIPHERTEXT });
    const { router } = buildRouter([row]);

    await router.forRead(ORG, 'dest-own');
    row.connectionDetailsEncrypted = crypto.encryptConnectionDetails(
      ORG,
      JSON.stringify({ endpoint: 'https://otro.ejemplo.test', bucket: 'otro', region: 'us-east-1', accessKey: 'AK-2', secretKey: 'SK-2', useSsl: true }),
    );
    await router.forRead(ORG, 'dest-own');

    expect(S3ClientMock).toHaveBeenCalledTimes(2);
  });

  it('la prueba de conexión de un destino propio escribe y borra el objeto en su bucket', async () => {
    const memory = memoryS3();
    S3ClientMock.mockImplementation(() => ({ send: memory.send }));
    const { router, environmentClient } = buildRouter([destination({ id: 'dest-own', isDefault: false, connectionDetailsEncrypted: OWN_CIPHERTEXT })]);

    await expect(router.probe(ORG, 'dest-own')).resolves.toEqual({ ok: true });

    expect(memory.putKeys[0]).toMatch(/^\.nexus-connection-test\/[0-9a-f-]{36}$/);
    expect(memory.objects.size).toBe(0);
    expect(environmentClient.send).not.toHaveBeenCalled();
  });

  it('la prueba de un destino de entorno usa el cliente de entorno y su bucket', async () => {
    const memory = memoryS3();
    const { router, environmentClient } = buildRouter();
    environmentClient.send.mockImplementation(memory.send);

    await expect(router.probe(ORG, 'dest-a')).resolves.toEqual({ ok: true });

    expect(memory.putKeys).toHaveLength(1);
    expect(S3ClientMock).not.toHaveBeenCalled();
  });

  it('la prueba de un destino de otra organización responde 404 sin conectarse', async () => {
    const { router, environmentClient } = buildRouter([destination({ id: 'dest-a', organizationId: OTHER_ORG })]);

    await expect(router.probe(ORG, 'dest-a')).rejects.toBeInstanceOf(NotFoundException);
    expect(environmentClient.send).not.toHaveBeenCalled();
  });
});

describe('SPEC-802: prueba de conexión (escenario 3)', () => {
  it('escribe, lee, compara y borra el objeto de prueba cuando todo coincide', async () => {
    const memory = memoryS3();

    await expect(runConnectionProbe(memory, 'bucket')).resolves.toEqual({ ok: true });

    expect(memory.putKeys).toHaveLength(1);
    expect(memory.objects.size).toBe(0);
  });

  it('falla con DATA_MISMATCH si el contenido leído no es el escrito, y borra el objeto', async () => {
    const memory = memoryS3();
    const client = {
      send: jest.fn(async (command: unknown) =>
        command instanceof GetObjectCommand ? { Body: Readable.from([Buffer.from('otro contenido')]) } : memory.send(command),
      ),
    };

    await expect(runConnectionProbe(client, 'bucket')).resolves.toEqual({ ok: false, reason: 'DATA_MISMATCH' });
    expect(memory.objects.size).toBe(0);
  });

  it.each([
    [{ name: 'SignatureDoesNotMatch', $metadata: { httpStatusCode: 403 } }, 'AUTH'],
    [{ name: 'InvalidAccessKeyId', $metadata: { httpStatusCode: 403 } }, 'AUTH'],
    [{ name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } }, 'BUCKET_NOT_FOUND'],
    [{ code: 'ECONNREFUSED' }, 'NETWORK'],
    [{ name: 'SomethingUnknown' }, 'NETWORK'],
  ])('clasifica el fallo %j como %s sin copiar el mensaje crudo', async (error, reason) => {
    const result = await runConnectionProbe(failingS3(error), 'bucket');

    expect(result).toEqual({ ok: false, reason });
    expect(JSON.stringify(result)).not.toContain('mensaje crudo');
  });

  it('falla con NETWORK si la lectura se queda colgada, y borra el objeto que sí se escribió', async () => {
    const memory = memoryS3();
    const client = {
      send: jest.fn(async (command: unknown) =>
        command instanceof GetObjectCommand ? new Promise(() => undefined) : memory.send(command),
      ),
    };

    await expect(runConnectionProbe(client, 'bucket', 20)).resolves.toEqual({ ok: false, reason: 'NETWORK' });
    expect(memory.objects.size).toBe(0);
  });

  it('un bucket inexistente responde BUCKET_NOT_FOUND antes de escribir, aunque el servidor crearía el bucket con un PUT', async () => {
    const memory = memoryS3();
    const client = {
      send: jest.fn(async (command: unknown) => {
        if (command instanceof HeadBucketCommand) {
          throw Object.assign(new Error('Not Found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
        }
        return memory.send(command);
      }),
    };

    await expect(runConnectionProbe(client, 'no-existe')).resolves.toEqual({ ok: false, reason: 'BUCKET_NOT_FOUND' });
    expect(memory.putKeys).toHaveLength(0);
  });

  it('classifyProbeError trata un error sin forma conocida como red', () => {
    expect(classifyProbeError(undefined)).toBe('NETWORK');
    expect(classifyProbeError('texto')).toBe('NETWORK');
  });
});
