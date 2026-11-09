import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { DestinationDefaults } from '../files/destination-defaults.service';
import { Destination } from '../files/entities/destination.entity';
import { DeploymentModel } from '../iam/domain/enums';
import { OrganizationRepository } from '../iam/ports/repositories';
import { UpdateStoragePolicyDto } from './dto/storage-policy.dto';
import { StoragePolicyService, StoragePolicyActor } from './storage-policy.service';

/**
 * SPEC-803 escenarios 1, 2, 3, 4, 10 y 12 (la parte de servicio; el 403 de rol va en storage-policy.routes.spec.ts),
 * más orden de la transacción, aislamiento por organización y auditoría tras el commit.
 * Los repositorios son en memoria: los filtros de destinos reproducen DestinationDefaults.listAvailable.
 */

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const ACTOR: StoragePolicyActor = { organizationId: ORG, userId: 'user-admin' };
const CLOUD_ID = '11111111-1111-4111-8111-111111111111';
const LOCAL_ID = '22222222-2222-4222-8222-222222222222';
const FOREIGN_ID = '33333333-3333-4333-8333-333333333333';
const DISABLED_ID = '44444444-4444-4444-8444-444444444444';
const OFFLINE_ID = '55555555-5555-4555-8555-555555555555';
const MISSING_ID = '66666666-6666-4666-8666-666666666666';
const CREATED_AT = new Date('2026-11-06T10:00:00Z');

type Location = 'cloud' | 'on_premises';

/** Fila con datos sensibles reales: si alguna llega a la respuesta, la prueba falla. */
function row(overrides: { id: string; location: Location } & Partial<Destination>): Destination {
  return {
    organizationId: ORG,
    name: `Destino ${overrides.location}`,
    providerType: 's3',
    connectionStatus: 'Conectado',
    isEnabled: true,
    isDefault: false,
    bucketOrPrefix: 'bucket-secreto',
    connectionDetailsEncrypted: 'cifrado-secreto',
    createdAt: CREATED_AT,
    updatedAt: null,
    ...overrides,
  } as Destination;
}

const cloudRow = (overrides: Partial<Destination> = {}): Destination =>
  row({ id: CLOUD_ID, location: 'cloud', isDefault: true, ...overrides });
const localRow = (overrides: Partial<Destination> = {}): Destination =>
  row({ id: LOCAL_ID, location: 'on_premises', ...overrides });

const dto = (model: DeploymentModel, defaultDestinationId: string): UpdateStoragePolicyDto => ({
  model,
  defaultDestinationId,
});

interface Fixture {
  rows: Destination[];
  model: DeploymentModel;
  orgExists?: boolean;
}

function setup(fixture: Fixture) {
  const state = { model: fixture.model, committed: false, auditedAfterCommit: null as boolean | null };
  const rows = fixture.rows;
  const manager = { update: jest.fn(), save: jest.fn(), insert: jest.fn(), delete: jest.fn() };

  const dataSource = {
    manager,
    transaction: jest.fn(async (work: (tx: typeof manager) => Promise<unknown>) => {
      state.committed = false;
      const result = await work(manager);
      state.committed = true;
      return result;
    }),
  };

  const organizations = {
    lockById: jest.fn(async () => fixture.orgExists ?? true),
    findDeploymentModel: jest.fn(async () => (fixture.orgExists === false ? null : state.model)),
    updateDeploymentModel: jest.fn(async (_tx: unknown, _org: string, model: DeploymentModel) => {
      state.model = model;
    }),
  };

  const destinationDefaults = {
    listAvailable: jest.fn(async (_tx: unknown, org: string) =>
      rows.filter((r) => r.organizationId === org && r.isEnabled && r.connectionStatus === 'Conectado'),
    ),
    getDefault: jest.fn(async (_tx: unknown, org: string) =>
      rows.find((r) => r.organizationId === org && r.isDefault) ?? null,
    ),
    promoteToDefault: jest.fn(async (_tx: unknown, org: string, id: string) => {
      rows.forEach((r) => {
        if (r.organizationId === org) r.isDefault = r.id === id;
      });
    }),
  };

  const audit = {
    logEvent: jest.fn(async () => {
      state.auditedAfterCommit = state.committed;
    }),
  };

  const service = new StoragePolicyService(
    dataSource as unknown as DataSource,
    organizations as unknown as OrganizationRepository,
    destinationDefaults as unknown as DestinationDefaults,
    audit as unknown as AuditService,
  );

  return { service, state, rows, manager, dataSource, organizations, destinationDefaults, audit };
}

/** Ejecuta y devuelve el error HttpException, o null si no lanzó. */
async function failure(promise: Promise<unknown>): Promise<HttpException | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error as HttpException;
  }
}

const codeOf = (error: HttpException | null): string | undefined =>
  (error?.getResponse() as { code?: string } | undefined)?.code;

const messageOf = (error: HttpException | null): string | undefined =>
  (error?.getResponse() as { message?: string } | undefined)?.message;

describe('StoragePolicyService (SPEC-803)', () => {
  describe('escenario 1: consultar', () => {
    it('devuelve modelo, destinos disponibles y predeterminado, sin credenciales ni endpoint', async () => {
      const { service } = setup({ model: DeploymentModel.HYBRID, rows: [cloudRow(), localRow()] });

      const result = await service.get(ACTOR);

      expect(result).toEqual({
        model: 'hybrid',
        defaultDestinationId: CLOUD_ID,
        destinations: [
          { id: CLOUD_ID, name: 'Destino cloud', location: 'cloud' },
          { id: LOCAL_ID, name: 'Destino on_premises', location: 'on_premises' },
        ],
      });
      const text = JSON.stringify(result);
      for (const secret of ['bucket-secreto', 'cifrado-secreto', 'endpoint', 'accessKey', 'secretKey', 'connectionStatus']) {
        expect(text).not.toContain(secret);
      }
    });

    it('solo lista destinos de su organización, habilitados y conectados', async () => {
      const { service } = setup({
        model: DeploymentModel.CLOUD,
        rows: [
          cloudRow(),
          row({ id: FOREIGN_ID, location: 'cloud', organizationId: OTHER_ORG }),
          row({ id: DISABLED_ID, location: 'cloud', isEnabled: false }),
          row({ id: OFFLINE_ID, location: 'on_premises', connectionStatus: 'Sin conexión' }),
        ],
      });

      const result = await service.get(ACTOR);

      expect(result.destinations.map((d) => d.id)).toEqual([CLOUD_ID]);
    });

    it('defaultDestinationId es null si el predeterminado ya no está disponible', async () => {
      const { service } = setup({
        model: DeploymentModel.CLOUD,
        rows: [cloudRow({ isEnabled: false }), localRow()],
      });

      const result = await service.get(ACTOR);

      expect(result.defaultDestinationId).toBeNull();
    });

    it('organización inexistente → 404', async () => {
      const { service } = setup({ model: DeploymentModel.CLOUD, rows: [], orgExists: false });

      const error = await failure(service.get(ACTOR));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error?.getStatus()).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('escenario 2: cambiar a Local', () => {
    it('on_premises con destino Conectado: el modelo cambia y ese destino pasa a predeterminado', async () => {
      const { service, state, rows, organizations, destinationDefaults } = setup({
        model: DeploymentModel.CLOUD,
        rows: [cloudRow(), localRow()],
      });

      const result = await service.update(ACTOR, dto(DeploymentModel.ON_PREMISES, LOCAL_ID));

      expect(state.model).toBe('on_premises');
      expect(rows.find((r) => r.id === LOCAL_ID)?.isDefault).toBe(true);
      expect(rows.find((r) => r.id === CLOUD_ID)?.isDefault).toBe(false);
      expect(organizations.updateDeploymentModel).toHaveBeenCalledWith(expect.anything(), ORG, 'on_premises');
      expect(destinationDefaults.promoteToDefault).toHaveBeenCalledWith(expect.anything(), ORG, LOCAL_ID);
      expect(result).toEqual({
        model: 'on_premises',
        defaultDestinationId: LOCAL_ID,
        destinations: [
          { id: CLOUD_ID, name: 'Destino cloud', location: 'cloud' },
          { id: LOCAL_ID, name: 'Destino on_premises', location: 'on_premises' },
        ],
      });
    });
  });

  describe('escenario 3: requisitos del modelo', () => {
    it.each([
      ['cloud sin destino de nube', DeploymentModel.CLOUD, [localRow()], LOCAL_ID, 'Nube'],
      ['on_premises sin destino local', DeploymentModel.ON_PREMISES, [cloudRow()], CLOUD_ID, 'Servidor local'],
      ['hybrid sin destino local', DeploymentModel.HYBRID, [cloudRow()], CLOUD_ID, 'Servidor local'],
      ['hybrid sin destino de nube', DeploymentModel.HYBRID, [localRow()], LOCAL_ID, 'Nube'],
      ['hybrid sin ningún destino', DeploymentModel.HYBRID, [], CLOUD_ID, 'Nube y de Servidor local'],
    ])('%s → 422 DEPLOYMENT_MODEL_REQUIREMENTS_UNMET sin escribir', async (_label, model, rows, defaultId, expectedWord) => {
      const { service, organizations, destinationDefaults, manager, audit } = setup({ model: DeploymentModel.CLOUD, rows });

      const error = await failure(service.update(ACTOR, dto(model, defaultId)));

      expect(error?.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(codeOf(error)).toBe('DEPLOYMENT_MODEL_REQUIREMENTS_UNMET');
      expect(messageOf(error)).toContain(expectedWord);
      expect(organizations.updateDeploymentModel).not.toHaveBeenCalled();
      expect(destinationDefaults.promoteToDefault).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
      expect(audit.logEvent).not.toHaveBeenCalled();
    });

    it('el predeterminado debe ser de la ubicación del modelo cloud/on_premises', async () => {
      const { service, organizations, destinationDefaults } = setup({
        model: DeploymentModel.CLOUD,
        rows: [cloudRow({ isDefault: false }), localRow({ isDefault: true })],
      });

      const error = await failure(service.update(ACTOR, dto(DeploymentModel.CLOUD, LOCAL_ID)));

      expect(error?.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(codeOf(error)).toBe('DEPLOYMENT_MODEL_REQUIREMENTS_UNMET');
      expect(organizations.updateDeploymentModel).not.toHaveBeenCalled();
      expect(destinationDefaults.promoteToDefault).not.toHaveBeenCalled();
    });

    it('hybrid acepta como predeterminado un destino local', async () => {
      const { service, state } = setup({
        model: DeploymentModel.CLOUD,
        rows: [cloudRow(), localRow()],
      });

      const result = await service.update(ACTOR, dto(DeploymentModel.HYBRID, LOCAL_ID));

      expect(state.model).toBe('hybrid');
      expect(result.defaultDestinationId).toBe(LOCAL_ID);
    });
  });

  describe('escenario 10: destino inválido', () => {
    it.each([
      ['ajeno a la organización', row({ id: FOREIGN_ID, location: 'cloud', organizationId: OTHER_ORG })],
      ['deshabilitado', row({ id: FOREIGN_ID, location: 'cloud', isEnabled: false })],
      ['no conectado', row({ id: FOREIGN_ID, location: 'cloud', connectionStatus: 'Sin conexión' })],
    ])('destino %s → 422 DESTINATION_NOT_AVAILABLE sin escribir', async (_label, candidate) => {
      const { service, organizations, destinationDefaults, manager } = setup({
        model: DeploymentModel.CLOUD,
        rows: [cloudRow(), candidate],
      });

      const error = await failure(service.update(ACTOR, dto(DeploymentModel.CLOUD, FOREIGN_ID)));

      expect(error?.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(codeOf(error)).toBe('DESTINATION_NOT_AVAILABLE');
      expect(organizations.updateDeploymentModel).not.toHaveBeenCalled();
      expect(destinationDefaults.promoteToDefault).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('destino inexistente → 422 DESTINATION_NOT_AVAILABLE', async () => {
      const { service, organizations } = setup({ model: DeploymentModel.CLOUD, rows: [cloudRow()] });

      const error = await failure(service.update(ACTOR, dto(DeploymentModel.CLOUD, MISSING_ID)));

      expect(codeOf(error)).toBe('DESTINATION_NOT_AVAILABLE');
      expect(organizations.updateDeploymentModel).not.toHaveBeenCalled();
    });
  });

  describe('escenario 4: nada se mueve', () => {
    it('cambiar de modelo no escribe en el almacén de tablas de versiones ni de carpetas', async () => {
      const { service, manager, destinationDefaults } = setup({
        model: DeploymentModel.HYBRID,
        rows: [cloudRow(), localRow()],
      });

      await service.update(ACTOR, dto(DeploymentModel.ON_PREMISES, LOCAL_ID));

      // Las raíces de los Drives se repuntan dentro de DestinationDefaults (SPEC-803 §8). El coordinador no escribe
      // directamente: ni versiones (files.file_version) ni carpetas (files.folder).
      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.insert).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
      expect(destinationDefaults.promoteToDefault).toHaveBeenCalledTimes(1);
    });
  });

  describe('orden, transacción y aislamiento', () => {
    it('bloquea la organización antes de leer destinos y de escribir', async () => {
      const { service, organizations, destinationDefaults } = setup({
        model: DeploymentModel.CLOUD,
        rows: [cloudRow(), localRow()],
      });

      await service.update(ACTOR, dto(DeploymentModel.ON_PREMISES, LOCAL_ID));

      const lockOrder = organizations.lockById.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(destinationDefaults.listAvailable.mock.invocationCallOrder[0]);
      expect(lockOrder).toBeLessThan(organizations.updateDeploymentModel.mock.invocationCallOrder[0]);
      expect(destinationDefaults.listAvailable.mock.invocationCallOrder[0]).toBeLessThan(
        destinationDefaults.promoteToDefault.mock.invocationCallOrder[0],
      );
    });

    it('todas las consultas usan el organizationId de la sesión', async () => {
      const { service, organizations, destinationDefaults } = setup({
        model: DeploymentModel.CLOUD,
        rows: [cloudRow(), localRow()],
      });

      await service.update(ACTOR, dto(DeploymentModel.ON_PREMISES, LOCAL_ID));

      expect(organizations.lockById).toHaveBeenCalledWith(expect.anything(), ORG);
      expect(destinationDefaults.listAvailable).toHaveBeenCalledWith(expect.anything(), ORG);
      expect(destinationDefaults.promoteToDefault).toHaveBeenCalledWith(expect.anything(), ORG, LOCAL_ID);
    });

    it('organización inexistente → 404 sin leer destinos ni escribir', async () => {
      const { service, organizations, destinationDefaults, audit } = setup({
        model: DeploymentModel.CLOUD,
        rows: [cloudRow()],
        orgExists: false,
      });

      const error = await failure(service.update(ACTOR, dto(DeploymentModel.CLOUD, CLOUD_ID)));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error?.getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect(messageOf(error)).toBe('Organización no encontrada');
      expect(destinationDefaults.listAvailable).not.toHaveBeenCalled();
      expect(organizations.updateDeploymentModel).not.toHaveBeenCalled();
      expect(audit.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('auditoría DEPLOYMENT_MODEL_CHANGED', () => {
    it('se emite tras el commit con los campos exactos', async () => {
      const { service, state, audit } = setup({
        model: DeploymentModel.CLOUD,
        rows: [cloudRow(), localRow()],
      });

      await service.update(ACTOR, dto(DeploymentModel.ON_PREMISES, LOCAL_ID));

      expect(audit.logEvent).toHaveBeenCalledTimes(1);
      expect(audit.logEvent).toHaveBeenCalledWith({
        organizationId: ORG,
        actorId: 'user-admin',
        action: AuditAction.DEPLOYMENT_MODEL_CHANGED,
        resourceType: AuditResource.ORGANIZATION,
        resourceId: ORG,
      });
      expect(state.auditedAfterCommit).toBe(true);
    });

    it('funciona sin AuditService (es opcional, como en destinations)', async () => {
      const { dataSource, organizations, destinationDefaults } = setup({
        model: DeploymentModel.CLOUD,
        rows: [cloudRow(), localRow()],
      });
      const service = new StoragePolicyService(
        dataSource as unknown as DataSource,
        organizations as unknown as OrganizationRepository,
        destinationDefaults as unknown as DestinationDefaults,
      );

      const result = await service.update(ACTOR, dto(DeploymentModel.ON_PREMISES, LOCAL_ID));

      expect(result.model).toBe('on_premises');
    });
  });
});
