import { HttpException } from '@nestjs/common';
import { DeploymentModel } from '../../iam/domain/enums';
import { Destination } from '../entities/destination.entity';
import { FolderPlacementService, PlacementParent } from './folder-placement.service';

/**
 * SPEC-803 escenarios 5 a 8 y 10: en qué destino nace una carpeta nueva según el modelo de la organización,
 * si es principal o subcarpeta, y si el cliente envía destinationId. El manager simula el `where` como SQL:
 * una fila solo aparece si cumple todas las condiciones, así que la prueba verifica el filtro real.
 */

const ORG = 'org-1';
const DEFAULT_ROW = { id: 'dest-default', organizationId: ORG, isEnabled: true, connectionStatus: 'Sin comprobar', location: 'cloud' };

/** Destinos de prueba: uno por cada caso que la regla distingue. */
const ROWS: Array<Record<string, unknown>> = [
  DEFAULT_ROW,
  { id: 'dest-ok', organizationId: ORG, isEnabled: true, connectionStatus: 'Conectado', location: 'on_premises' },
  { id: 'dest-ajeno', organizationId: 'org-2', isEnabled: true, connectionStatus: 'Conectado', location: 'on_premises' },
  { id: 'dest-off', organizationId: ORG, isEnabled: false, connectionStatus: 'Conectado', location: 'on_premises' },
  { id: 'dest-sin-conexion', organizationId: ORG, isEnabled: true, connectionStatus: 'Sin conexión', location: 'on_premises' },
];

const ROOT: PlacementParent = { parentId: null, destinationId: 'dest-default' };
const SUB: PlacementParent = { parentId: 'root-1', destinationId: 'dest-ok' };

const modelSource = (model: DeploymentModel | null) => ({
  findDeploymentModel: jest.fn().mockResolvedValue(model),
});

/** `manager.findOne(Destination, { where })`: solo encuentra filas que cumplen todas las condiciones del where. */
const buildManager = () => {
  const findOne = jest.fn(async (_entity: unknown, { where }: { where: Record<string, unknown> }) =>
    ROWS.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null);
  return { manager: { findOne } as never, findOne };
};

const build = (model: DeploymentModel | null) => {
  const source = modelSource(model);
  const service = new FolderPlacementService({ getRepository: jest.fn() } as never, source as never);
  const { manager, findOne } = buildManager();
  return { service, source, manager, findOne };
};

const input = (parent: PlacementParent, requestedDestinationId?: string) => ({
  organizationId: ORG,
  parent,
  requestedDestinationId,
  defaultDestination: DEFAULT_ROW as unknown as Destination,
});

/** Código y estado HTTP de una regla de negocio rechazada. Si la operación no falla, la prueba falla. */
const businessRejection = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (reason: unknown) => reason);
  if (!(error instanceof HttpException)) throw new Error('la operación debía rechazarse con HttpException');
  return { status: error.getStatus(), code: (error.getResponse() as { code: string }).code };
};

describe('FolderPlacementService: carpeta principal (hija directa de la raíz del Drive)', () => {
  describe.each([DeploymentModel.CLOUD, DeploymentModel.ON_PREMISES, null])('modelo %s', (model) => {
    it('sin destinationId usa el predeterminado', async () => {
      const { service } = build(model);

      const destination = await service.resolveForNewFolder({} as never, input(ROOT));

      expect(destination.id).toBe('dest-default');
    });

    it.each(['dest-ok', 'dest-ajeno', 'dest-off', 'dest-sin-conexion'])(
      'con destinationId %s responde 422 DESTINATION_SELECTION_NOT_ALLOWED sin consultar destinos',
      async (requested) => {
        const { service, findOne } = build(model);

        const rejection = await businessRejection(service.resolveForNewFolder({} as never, input(ROOT, requested)));

        expect(rejection).toEqual({ status: 422, code: 'DESTINATION_SELECTION_NOT_ALLOWED' });
        expect(findOne).not.toHaveBeenCalled();
      },
    );
  });

  describe('modelo hybrid', () => {
    it('sin destinationId usa el predeterminado', async () => {
      const { service } = build(DeploymentModel.HYBRID);

      const destination = await service.resolveForNewFolder({} as never, input(ROOT));

      expect(destination.id).toBe('dest-default');
    });

    it('con un destino disponible lo usa, buscándolo por id, organización, habilitado y Conectado', async () => {
      const { service, findOne, manager } = build(DeploymentModel.HYBRID);

      const destination = await service.resolveForNewFolder(manager, input(ROOT, 'dest-ok'));

      expect(destination.id).toBe('dest-ok');
      expect(findOne).toHaveBeenCalledWith(Destination, {
        where: { id: 'dest-ok', organizationId: ORG, isEnabled: true, connectionStatus: 'Conectado' },
      });
    });

    it.each(['dest-ajeno', 'dest-off', 'dest-sin-conexion', 'dest-inexistente'])(
      'con %s responde 422 DESTINATION_NOT_AVAILABLE',
      async (requested) => {
        const { service, manager } = build(DeploymentModel.HYBRID);

        const rejection = await businessRejection(service.resolveForNewFolder(manager, input(ROOT, requested)));

        expect(rejection).toEqual({ status: 422, code: 'DESTINATION_NOT_AVAILABLE' });
      },
    );
  });

  it('lee el modelo dentro de la transacción recibida', async () => {
    const { service, source, manager } = build(DeploymentModel.CLOUD);

    await service.resolveForNewFolder(manager, input(ROOT));

    expect(source.findDeploymentModel).toHaveBeenCalledWith(manager, ORG);
  });
});

describe('FolderPlacementService: subcarpeta (hereda el destino de su padre)', () => {
  it.each([DeploymentModel.CLOUD, DeploymentModel.ON_PREMISES, DeploymentModel.HYBRID, null])(
    'modelo %s: hereda el destino del padre sin consultar el modelo',
    async (model) => {
      const { service, source, manager } = build(model);

      const destination = await service.resolveForNewFolder(manager, input(SUB));

      expect(destination.id).toBe('dest-ok');
      expect(source.findDeploymentModel).not.toHaveBeenCalled();
    },
  );

  it.each([DeploymentModel.CLOUD, DeploymentModel.ON_PREMISES, DeploymentModel.HYBRID, null])(
    'modelo %s: cualquier destinationId responde 422 DESTINATION_SELECTION_NOT_ALLOWED, también el del padre',
    async (model) => {
      const { service, findOne } = build(model);

      for (const requested of ['dest-ok', 'dest-default', 'dest-ajeno', 'dest-off', 'dest-sin-conexion']) {
        const rejection = await businessRejection(service.resolveForNewFolder({} as never, input(SUB, requested)));
        expect(rejection).toEqual({ status: 422, code: 'DESTINATION_SELECTION_NOT_ALLOWED' });
      }
      expect(findOne).not.toHaveBeenCalled();
    },
  );

  it('si el padre no tiene destino, usa el predeterminado', async () => {
    const { service } = build(DeploymentModel.HYBRID);

    const destination = await service.resolveForNewFolder({} as never, input({ parentId: 'root-1', destinationId: null }));

    expect(destination.id).toBe('dest-default');
  });

  it('si el destino del padre ya no existe para la organización responde 422 DESTINATION_NOT_AVAILABLE', async () => {
    const { service, manager } = build(DeploymentModel.HYBRID);

    const rejection = await businessRejection(
      service.resolveForNewFolder(manager, input({ parentId: 'root-1', destinationId: 'dest-ajeno-borrado' })),
    );

    expect(rejection).toEqual({ status: 422, code: 'DESTINATION_NOT_AVAILABLE' });
  });
});

describe('FolderPlacementService.locationsOf', () => {
  const buildLocations = () => {
    const find = jest.fn(async ({ where }: { where: { organizationId: string; id: unknown } }) => {
      const ids = (where.id as { value: string[] }).value;
      return ROWS.filter((row) => row.organizationId === where.organizationId && ids.includes(row.id as string));
    });
    const dataSource = { getRepository: jest.fn(() => ({ find })) };
    const service = new FolderPlacementService(dataSource as never, modelSource(null) as never);
    return { service, find };
  };

  it('devuelve la ubicación de cada destino con una sola consulta, ignorando nulls y repetidos', async () => {
    const { service, find } = buildLocations();

    const locations = await service.locationsOf(ORG, ['dest-ok', null, 'dest-default', 'dest-ok']);

    expect(locations).toEqual(new Map([['dest-ok', 'on_premises'], ['dest-default', 'cloud']]));
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0][0].where.organizationId).toBe(ORG);
    expect((find.mock.calls[0][0].where.id as { value: string[] }).value).toEqual(['dest-ok', 'dest-default']);
  });

  it('no devuelve destinos de otra organización', async () => {
    const { service } = buildLocations();

    const locations = await service.locationsOf(ORG, ['dest-ajeno']);

    expect(locations.size).toBe(0);
  });

  it('sin ids válidas no consulta la base', async () => {
    const { service, find } = buildLocations();

    const locations = await service.locationsOf(ORG, [null, null]);

    expect(locations.size).toBe(0);
    expect(find).not.toHaveBeenCalled();
  });
});
