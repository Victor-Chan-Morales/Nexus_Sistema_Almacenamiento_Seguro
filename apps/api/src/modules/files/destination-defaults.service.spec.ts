import { HttpException, HttpStatus } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { DestinationDefaults } from './destination-defaults.service';
import { Destination } from './entities/destination.entity';
import { Folder } from './entities/folder.entity';

const ORG = 'org-1';
const TARGET_ID = 'dest-target';

function destination(overrides: Partial<Destination> = {}): Destination {
  return Object.assign(new Destination(), {
    id: TARGET_ID,
    organizationId: ORG,
    isEnabled: true,
    isDefault: false,
    connectionStatus: 'Conectado',
    location: 'on_premises',
    ...overrides,
  });
}

function fakeManager(found: Destination | null = destination()) {
  const manager = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(found),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  return { manager, em: manager as unknown as EntityManager };
}

async function captureError(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Se esperaba una excepción');
}

describe('DestinationDefaults', () => {
  const service = new DestinationDefaults();

  describe('listAvailable', () => {
    it('solo devuelve destinos de la organización, habilitados y Conectados, por antigüedad', async () => {
      const { manager, em } = fakeManager();

      await service.listAvailable(em, ORG);

      expect(manager.find).toHaveBeenCalledWith(Destination, {
        where: { organizationId: ORG, isEnabled: true, connectionStatus: 'Conectado' },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('getDefault', () => {
    it('busca el destino marcado como predeterminado de la organización', async () => {
      const { manager, em } = fakeManager();

      await service.getDefault(em, ORG);

      expect(manager.findOne).toHaveBeenCalledWith(Destination, {
        where: { organizationId: ORG, isDefault: true },
      });
    });
  });

  describe('promoteToDefault', () => {
    it('bloquea el destino y quita el predeterminado anterior antes de marcar el nuevo (índice parcial único)', async () => {
      const { manager, em } = fakeManager();

      await service.promoteToDefault(em, ORG, TARGET_ID);

      expect(manager.findOne).toHaveBeenCalledWith(Destination, {
        where: { id: TARGET_ID, organizationId: ORG },
        lock: { mode: 'pessimistic_write' },
      });
      const [unsetCall, setCall] = manager.update.mock.calls;
      expect(unsetCall).toEqual([Destination, { organizationId: ORG, isDefault: true }, { isDefault: false }]);
      expect(setCall).toEqual([Destination, { id: TARGET_ID, organizationId: ORG }, { isDefault: true }]);
      expect(manager.update.mock.invocationCallOrder[0]).toBeLessThan(manager.update.mock.invocationCallOrder[1]);
    });

    it('repunta las raíces de todos los Drives de la organización y solo esas', async () => {
      const { manager, em } = fakeManager();

      await service.promoteToDefault(em, ORG, TARGET_ID);

      const rootsCall = manager.update.mock.calls[2];
      expect(rootsCall).toEqual([
        Folder,
        { organizationId: ORG, parentId: IsNull() },
        { destinationId: TARGET_ID },
      ]);
      expect(manager.update.mock.invocationCallOrder[1]).toBeLessThan(manager.update.mock.invocationCallOrder[2]);
    });

    it('rechaza un destino inexistente o de otra organización (422) sin escribir nada', async () => {
      const { manager, em } = fakeManager(null);

      const error = await captureError(service.promoteToDefault(em, ORG, 'dest-ajeno'));

      expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(error.getResponse()).toMatchObject({ code: 'DESTINATION_NOT_AVAILABLE' });
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('rechaza un destino deshabilitado (422) sin escribir nada', async () => {
      const { manager, em } = fakeManager(destination({ isEnabled: false }));

      const error = await captureError(service.promoteToDefault(em, ORG, TARGET_ID));

      expect(error.getResponse()).toMatchObject({ code: 'DESTINATION_NOT_AVAILABLE' });
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('rechaza un destino que no está Conectado (422) sin escribir nada', async () => {
      const { manager, em } = fakeManager(destination({ connectionStatus: 'Sin conexión' }));

      const error = await captureError(service.promoteToDefault(em, ORG, TARGET_ID));

      expect(error.getResponse()).toMatchObject({ code: 'DESTINATION_NOT_AVAILABLE' });
      expect(manager.update).not.toHaveBeenCalled();
    });
  });
});
