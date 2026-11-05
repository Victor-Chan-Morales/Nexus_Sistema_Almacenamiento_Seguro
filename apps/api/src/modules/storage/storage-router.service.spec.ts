import { ConflictException, NotFoundException } from '@nestjs/common';
import { Destination } from '../files/entities/destination.entity';
import { StorageRouter } from './storage-router.service';
import { StorageService } from './storage.service';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

const destination = (overrides: Partial<Destination> = {}): Destination =>
  Object.assign(new Destination(), {
    id: 'dest-a',
    organizationId: ORG,
    providerType: 's3',
    isEnabled: true,
    isDefault: true,
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
  const router = new StorageRouter(
    { findOne } as never,
    environment as unknown as StorageService,
  );
  return { router, findOne, environment };
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
