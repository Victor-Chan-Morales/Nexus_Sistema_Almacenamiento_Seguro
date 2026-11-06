import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'dns/promises';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { assertEndpointAllowed, classifyAddress, DestinationsService, DestinationActor } from './destinations.service';
import { CreateDestinationDto } from './dto/destination.dto';
import { Destination } from './entities/destination.entity';
import { FilesCryptoService } from './files-crypto.service';
import { StorageRouter } from '../storage/storage-router.service';

/**
 * SPEC-802 escenarios 1, 2, 4 a 9, y los destinos de entorno. La prueba de conexión (escenario 3) va en T3.
 * Al final: la política de endpoints (escenario 8), que resuelve DNS, así que el lookup va simulado.
 */

jest.mock('dns/promises', () => ({ lookup: jest.fn().mockResolvedValue([{ address: '203.0.113.10', family: 4 }]) }));
const lookupMock = lookup as unknown as jest.Mock;

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const ACTOR: DestinationActor = { organizationId: ORG, userId: 'user-1' };
const OTHER_ACTOR: DestinationActor = { organizationId: OTHER_ORG, userId: 'user-9' };
const ACCESS = 'AKIA-PRUEBA-123';
const SECRET = 'SECRETO-PRUEBA-456';
const PUBLIC_ENDPOINT = 'https://203.0.113.10:9000';
const MASTER_KEY = randomBytes(32).toString('base64');
const CREATED_AT = new Date('2026-11-06T10:00:00Z');

interface FolderLike {
  organizationId: string;
  destinationId: string;
  deletedAt: Date | null;
}

const createDto = (overrides: Partial<CreateDestinationDto> = {}): CreateDestinationDto => ({
  name: 'Respaldo',
  location: 'cloud',
  providerType: 's3',
  endpoint: PUBLIC_ENDPOINT,
  bucket: 'nexus-respaldo',
  region: 'us-east-1',
  accessKey: ACCESS,
  secretKey: SECRET,
  useSsl: true,
  ...overrides,
});

const failure = async (promise: Promise<unknown>): Promise<HttpException | null> => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error as HttpException;
  }
};

const setup = (allowPrivate = 'false') => {
  const rows: Destination[] = [];
  const folders: FolderLike[] = [];
  let sequence = 0;

  const upsert = (entity: Partial<Destination>): Destination => {
    const saved = {
      ...entity,
      id: entity.id ?? `00000000-0000-4000-8000-00000000000${++sequence}`,
      createdAt: entity.createdAt ?? CREATED_AT,
      updatedAt: null,
    } as Destination;
    const index = rows.findIndex((row) => row.id === saved.id);
    if (index >= 0) rows[index] = saved;
    else rows.push(saved);
    return { ...saved };
  };

  const repository = {
    find: jest.fn(async ({ where }: { where: { organizationId: string } }) =>
      rows.filter((row) => row.organizationId === where.organizationId).map((row) => ({ ...row })),
    ),
    findOne: jest.fn(async ({ where }: { where: { id: string; organizationId: string } }) => {
      const row = rows.find((r) => r.id === where.id && r.organizationId === where.organizationId);
      return row ? { ...row } : null;
    }),
    create: (data: Partial<Destination>) => ({ ...data }),
    save: jest.fn(async (entity: Partial<Destination>) => upsert(entity)),
  };

  const manager = {
    findOne: jest.fn(async (_entity: unknown, { where }: { where: { id: string; organizationId: string } }) => {
      const row = rows.find((r) => r.id === where.id && r.organizationId === where.organizationId);
      return row ? { ...row } : null;
    }),
    // El servicio usa IsNull() para deletedAt; el doble compara por null directamente.
    count: jest.fn(async (_entity: unknown, { where }: { where: { organizationId: string; destinationId: string } }) =>
      folders.filter(
        (f) => f.organizationId === where.organizationId && f.destinationId === where.destinationId && f.deletedAt === null,
      ).length,
    ),
    save: jest.fn(async (_entity: unknown, entity: Partial<Destination>) => upsert(entity)),
  };

  const dataSource = { transaction: jest.fn(async (work: (m: typeof manager) => unknown) => work(manager)) };
  const audit = { logEvent: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: (key: string) => ({ FILES_MASTER_KEY: MASTER_KEY, DESTINATION_ALLOW_PRIVATE: allowPrivate })[key],
  } as unknown as ConfigService;
  const crypto = new FilesCryptoService(config);
  const router = {
    probe: jest.fn().mockResolvedValue({ ok: true }),
    invalidate: jest.fn(),
  };

  const service = new DestinationsService(
    repository as never,
    dataSource as never,
    crypto,
    config,
    router as unknown as StorageRouter,
    audit as unknown as AuditService,
  );

  /** Destino de entorno tal como lo crea FilesService: referencias `environment:*`, cifradas igual. */
  const seedEnvironmentDefault = (organizationId = ORG): Destination => {
    const row = upsert({
      organizationId,
      name: 'Almacenamiento Nexus',
      location: 'cloud',
      providerType: 's3',
      connectionStatus: 'Sin comprobar',
      isEnabled: true,
      isDefault: true,
      bucketOrPrefix: `nexus-dev/${organizationId}`,
      connectionDetailsEncrypted: crypto.encryptConnectionDetails(
        organizationId,
        JSON.stringify({
          endpoint: 'environment:S3_ENDPOINT',
          credentials: 'environment:S3_ACCESS_KEY,S3_SECRET_KEY',
          bucket: 'environment:S3_BUCKET',
        }),
      ),
    });
    return row;
  };

  return { service, rows, folders, crypto, audit, repository, manager, router, seedEnvironmentDefault };
};

describe('DestinationsService (SPEC-802)', () => {
  describe('Escenario 1: registrar', () => {
    it('responde con el destino en "Sin comprobar", habilitado y sin predeterminado', async () => {
      const { service } = setup();

      const dto = await service.create(createDto(), ACTOR);

      expect(dto).toMatchObject({
        name: 'Respaldo',
        location: 'cloud',
        providerType: 's3',
        endpoint: PUBLIC_ENDPOINT,
        bucket: 'nexus-respaldo',
        region: 'us-east-1',
        connectionStatus: 'Sin comprobar',
        isEnabled: true,
        isDefault: false,
      });
      expect(dto.createdAt).toBe(CREATED_AT.toISOString());
    });
  });

  describe('Escenario 2: credenciales protegidas', () => {
    it('guarda las credenciales cifradas y no las pone en la respuesta ni en la auditoría', async () => {
      const { service, rows, crypto, audit } = setup();

      const dto = await service.create(createDto(), ACTOR);

      const stored = rows[0].connectionDetailsEncrypted;
      expect(stored).not.toContain(ACCESS);
      expect(stored).not.toContain(SECRET);
      expect(JSON.parse(crypto.decryptConnectionDetails(ORG, stored))).toMatchObject({ accessKey: ACCESS, secretKey: SECRET });

      expect(dto).not.toHaveProperty('accessKey');
      expect(dto).not.toHaveProperty('secretKey');
      expect(JSON.stringify(dto)).not.toContain(SECRET);
      expect(JSON.stringify(audit.logEvent.mock.calls)).not.toContain(SECRET);
      expect(JSON.stringify(audit.logEvent.mock.calls)).not.toContain(ACCESS);
    });

    it('registra DESTINATION_CREATED con el recurso destino', async () => {
      const { service, audit, rows } = setup();

      await service.create(createDto(), ACTOR);

      expect(audit.logEvent).toHaveBeenCalledWith({
        organizationId: ORG,
        actorId: ACTOR.userId,
        action: 'DESTINATION_CREATED',
        resourceType: 'destination',
        resourceId: rows[0].id,
      });
    });
  });

  describe('Escenario 4: listar', () => {
    it('lista solo los destinos de la organización con sus campos públicos', async () => {
      const { service, seedEnvironmentDefault } = setup();
      seedEnvironmentDefault();
      await service.create(createDto(), ACTOR);
      await service.create(createDto({ name: 'Ajeno' }), OTHER_ACTOR);

      const { items } = await service.list(ACTOR);

      expect(items.map((item) => item.name)).toEqual(['Almacenamiento Nexus', 'Respaldo']);
      expect(items[0]).toMatchObject({ isDefault: true, endpoint: null, region: null, connectionStatus: 'Sin comprobar' });
      expect(items[1]).toMatchObject({ endpoint: PUBLIC_ENDPOINT, location: 'cloud', providerType: 's3' });
      expect(JSON.stringify(items)).not.toContain(SECRET);
      expect(JSON.stringify(items)).not.toContain('environment:');
    });
  });

  describe('Escenario 5: actualizar', () => {
    it('devuelve el estado a "Sin comprobar" y conserva la secretKey si se omite', async () => {
      const { service, rows, crypto } = setup();
      const created = await service.create(createDto(), ACTOR);
      rows[0].connectionStatus = 'Conectado';

      const updated = await service.update(created.id, { region: 'eu-west-1', accessKey: 'AK-NUEVA' }, ACTOR);

      expect(updated).toMatchObject({ connectionStatus: 'Sin comprobar', region: 'eu-west-1' });
      expect(JSON.parse(crypto.decryptConnectionDetails(ORG, rows[0].connectionDetailsEncrypted))).toMatchObject({
        accessKey: 'AK-NUEVA',
        secretKey: SECRET,
      });
    });

    it('registra DESTINATION_UPDATED sin credenciales', async () => {
      const { service, audit } = setup();
      const created = await service.create(createDto(), ACTOR);

      await service.update(created.id, { name: 'Nuevo nombre' }, ACTOR);

      expect(audit.logEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: 'DESTINATION_UPDATED', resourceId: created.id }),
      );
      expect(JSON.stringify(audit.logEvent.mock.calls)).not.toContain(SECRET);
    });
  });

  describe('Escenario 6: deshabilitar', () => {
    it('permite deshabilitar un destino sin uso activo', async () => {
      const { service } = setup();
      const created = await service.create(createDto(), ACTOR);

      const updated = await service.update(created.id, { isEnabled: false }, ACTOR);

      expect(updated.isEnabled).toBe(false);
    });
  });

  describe('Escenario 7: en uso o predeterminado', () => {
    it('rechaza deshabilitar el destino predeterminado con 422 DESTINATION_IN_USE', async () => {
      const { service, seedEnvironmentDefault, rows } = setup();
      const def = seedEnvironmentDefault();

      const error = await failure(service.update(def.id, { isEnabled: false }, ACTOR));

      expect(error?.getStatus()).toBe(422);
      expect(error?.getResponse()).toMatchObject({ code: 'DESTINATION_IN_USE' });
      expect(rows.find((r) => r.id === def.id)?.isEnabled).toBe(true);
    });

    it('rechaza deshabilitar un destino con carpetas activas asignadas', async () => {
      const { service, folders } = setup();
      const created = await service.create(createDto(), ACTOR);
      folders.push({ organizationId: ORG, destinationId: created.id, deletedAt: null });

      const error = await failure(service.update(created.id, { isEnabled: false }, ACTOR));

      expect(error?.getResponse()).toMatchObject({ code: 'DESTINATION_IN_USE' });
    });

    it('permite deshabilitarlo si sus carpetas están en la papelera', async () => {
      const { service, folders } = setup();
      const created = await service.create(createDto(), ACTOR);
      folders.push({ organizationId: ORG, destinationId: created.id, deletedAt: new Date() });

      const updated = await service.update(created.id, { isEnabled: false }, ACTOR);

      expect(updated.isEnabled).toBe(false);
    });
  });

  describe('Escenario 8: endpoint no permitido', () => {
    it.each(['http://127.0.0.1:9000', 'http://169.254.169.254', 'http://[::1]:9000'])(
      'rechaza %s con 422 y no guarda nada',
      async (endpoint) => {
        const { service, repository } = setup();

        const error = await failure(service.create(createDto({ endpoint }), ACTOR));

        expect(error?.getStatus()).toBe(422);
        expect(error?.getResponse()).toMatchObject({ code: 'DESTINATION_ENDPOINT_NOT_ALLOWED' });
        expect(repository.save).not.toHaveBeenCalled();
      },
    );

    it('rechaza un rango privado sin la bandera y lo admite con ella', async () => {
      const privateDto = createDto({ endpoint: 'http://10.0.0.5:9000' });

      const blocked = setup('false');
      expect(await failure(blocked.service.create(privateDto, ACTOR))).not.toBeNull();

      const allowed = setup('true');
      await expect(allowed.service.create(privateDto, ACTOR)).resolves.toMatchObject({ endpoint: 'http://10.0.0.5:9000' });
    });

    it('valida también el endpoint al actualizarlo y conserva el anterior si falla', async () => {
      const { service, rows } = setup();
      const created = await service.create(createDto(), ACTOR);

      const error = await failure(service.update(created.id, { endpoint: 'http://127.0.0.1:9000' }, ACTOR));

      expect(error?.getResponse()).toMatchObject({ code: 'DESTINATION_ENDPOINT_NOT_ALLOWED' });
      expect(JSON.stringify(rows[0])).not.toContain('127.0.0.1');
    });
  });

  describe('Escenario 9: aislamiento', () => {
    it('responde 404 al editar un destino de otra organización', async () => {
      const { service } = setup();
      const created = await service.create(createDto(), OTHER_ACTOR);

      const error = await failure(service.update(created.id, { name: 'Intruso' }, ACTOR));

      expect(error?.getStatus()).toBe(404);
    });
  });

  describe('destinos de entorno', () => {
    it('no permite reemplazar sus datos de conexión desde la API', async () => {
      const { service, seedEnvironmentDefault } = setup();
      const def = seedEnvironmentDefault();

      const error = await failure(service.update(def.id, { endpoint: PUBLIC_ENDPOINT }, ACTOR));

      expect(error?.getStatus()).toBe(400);
      expect(error?.getResponse()).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('sí permite cambiar su nombre sin tocar la configuración del servidor', async () => {
      const { service, seedEnvironmentDefault, rows } = setup();
      const def = seedEnvironmentDefault();
      const before = rows[0].connectionDetailsEncrypted;

      const updated = await service.update(def.id, { name: 'Principal' }, ACTOR);

      expect(updated).toMatchObject({ name: 'Principal', endpoint: null, isDefault: true });
      expect(rows[0].connectionDetailsEncrypted).toBe(before);
    });
  });
});

const NOT_ALLOWED = { code: 'DESTINATION_ENDPOINT_NOT_ALLOWED' };

describe('classifyAddress (SPEC-802)', () => {
  it.each([
    ['203.0.113.10', 'public'],
    ['8.8.8.8', 'public'],
    ['172.32.0.1', 'public'],
    ['127.0.0.1', 'blocked'],
    ['0.0.0.0', 'blocked'],
    ['169.254.169.254', 'blocked'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['192.168.1.10', 'private'],
    ['100.64.0.1', 'private'],
    ['::1', 'blocked'],
    ['::', 'blocked'],
    ['fe80::1', 'blocked'],
    ['fc00::1', 'private'],
    ['2001:db8::1', 'public'],
    ['::ffff:127.0.0.1', 'blocked'],
    ['::ffff:7f00:1', 'blocked'],
    ['::ffff:10.0.0.1', 'private'],
    ['0:0:0:0:0:ffff:a9fe:a9fe', 'blocked'],
    ['no-es-ip', 'blocked'],
  ])('%s → %s', (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
  });
});

describe('assertEndpointAllowed (SPEC-802 escenario 8)', () => {
  beforeEach(() => lookupMock.mockReset());

  it('acepta un host que resuelve solo a direcciones públicas', async () => {
    lookupMock.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);

    await expect(assertEndpointAllowed('https://s3.ejemplo.test:9000', false)).resolves.toBeUndefined();
  });

  it('rechaza un nombre público que resuelve a loopback', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    const error = await failure(assertEndpointAllowed('https://s3.ejemplo.test', false));
    expect(error?.getResponse()).toMatchObject(NOT_ALLOWED);
  });

  it('rechaza si cualquiera de las direcciones resueltas está bloqueada', async () => {
    lookupMock.mockResolvedValue([
      { address: '203.0.113.10', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);

    const error = await failure(assertEndpointAllowed('https://s3.ejemplo.test', true));
    expect(error?.getResponse()).toMatchObject(NOT_ALLOWED);
  });

  it('rechaza un host que no resuelve', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'));

    const error = await failure(assertEndpointAllowed('https://no-existe.ejemplo.test', true));
    expect(error?.getResponse()).toMatchObject(NOT_ALLOWED);
  });

  it('rechaza una URL que no se puede interpretar', async () => {
    const error = await failure(assertEndpointAllowed('no es una url', false));

    expect(error?.getResponse()).toMatchObject(NOT_ALLOWED);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rechaza una IPv6 literal de loopback sin consultar DNS', async () => {
    const error = await failure(assertEndpointAllowed('https://[::1]:9000', true));

    expect(error?.getResponse()).toMatchObject(NOT_ALLOWED);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('admite un rango privado solo con la bandera DESTINATION_ALLOW_PRIVATE', async () => {
    const endpoint = 'http://10.0.0.5:9000';

    expect(await failure(assertEndpointAllowed(endpoint, false))).not.toBeNull();
    await expect(assertEndpointAllowed(endpoint, true)).resolves.toBeUndefined();
  });

  it('nunca admite loopback ni metadatos aunque la bandera esté activa', async () => {
    expect(await failure(assertEndpointAllowed('http://127.0.0.1:9000', true))).not.toBeNull();
    expect(await failure(assertEndpointAllowed('http://169.254.169.254', true))).not.toBeNull();
  });
});

describe('SPEC-802 escenario 3: probar conexión', () => {
  it('deja el destino en Conectado cuando la prueba pasa, y audita DESTINATION_TESTED', async () => {
    const { service, rows, router, audit } = setup();
    const created = await service.create(createDto(), ACTOR);

    const result = await service.testConnection(created.id, ACTOR);

    expect(result).toMatchObject({ status: 'Conectado', reason: null });
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rows[0].connectionStatus).toBe('Conectado');
    expect(router.probe).toHaveBeenCalledWith(ORG, created.id);
    expect(audit.logEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'DESTINATION_TESTED', resourceId: created.id }),
    );
  });

  it('deja el destino en Sin conexión con un motivo seguro, sin detalle del SDK ni credenciales', async () => {
    const { service, rows, router } = setup();
    const created = await service.create(createDto(), ACTOR);
    router.probe.mockResolvedValueOnce({ ok: false, reason: 'AUTH' });

    const result = await service.testConnection(created.id, ACTOR);

    expect(result).toMatchObject({ status: 'Sin conexión', reason: 'AUTH' });
    expect(rows[0].connectionStatus).toBe('Sin conexión');
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(ACCESS);
  });

  it('muestra Comprobando mientras corre la prueba', async () => {
    const { service, rows, router } = setup();
    const created = await service.create(createDto(), ACTOR);
    let seenDuringProbe: string | undefined;
    router.probe.mockImplementationOnce(async () => {
      seenDuringProbe = rows[0].connectionStatus;
      return { ok: true };
    });

    await service.testConnection(created.id, ACTOR);

    expect(seenDuringProbe).toBe('Comprobando');
  });

  it('repite la validación del endpoint antes de probar: si el DNS ahora apunta a loopback, no se conecta', async () => {
    const { service, rows, router } = setup();
    lookupMock.mockResolvedValueOnce([{ address: '203.0.113.10', family: 4 }]);
    const created = await service.create(createDto({ endpoint: 'https://almacen.ejemplo.test' }), ACTOR);
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    const error = await failure(service.testConnection(created.id, ACTOR));

    expect(error?.getStatus()).toBe(422);
    expect(error?.getResponse()).toMatchObject({ code: 'DESTINATION_ENDPOINT_NOT_ALLOWED' });
    expect(router.probe).not.toHaveBeenCalled();
    expect(rows[0].connectionStatus).toBe('Sin comprobar');
  });

  it('no prueba un destino deshabilitado', async () => {
    const { service, router } = setup();
    const created = await service.create(createDto(), ACTOR);
    await service.update(created.id, { isEnabled: false }, ACTOR);

    const error = await failure(service.testConnection(created.id, ACTOR));

    expect(error?.getStatus()).toBe(409);
    expect(error?.getResponse()).toMatchObject({ code: 'CONFLICT' });
    expect(router.probe).not.toHaveBeenCalled();
  });

  it('responde 404 al probar un destino de otra organización sin conectarse', async () => {
    const { service, router } = setup();
    const created = await service.create(createDto(), OTHER_ACTOR);

    const error = await failure(service.testConnection(created.id, ACTOR));

    expect(error?.getStatus()).toBe(404);
    expect(router.probe).not.toHaveBeenCalled();
  });

  it('prueba también el destino de entorno, sin validar un endpoint que no expone', async () => {
    const { service, seedEnvironmentDefault, router } = setup();
    const def = seedEnvironmentDefault();

    const result = await service.testConnection(def.id, ACTOR);

    expect(result.status).toBe('Conectado');
    expect(router.probe).toHaveBeenCalledWith(ORG, def.id);
  });

  it('al editar, descarta el cliente cacheado del router', async () => {
    const { service, router } = setup();
    const created = await service.create(createDto(), ACTOR);

    await service.update(created.id, { region: 'eu-west-1' }, ACTOR);

    expect(router.invalidate).toHaveBeenCalledWith(created.id);
  });
});
