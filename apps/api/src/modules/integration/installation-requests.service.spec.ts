import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { OrganizationRepository } from '../iam/ports/repositories';
import { DeploymentModel } from '../iam/domain/enums';
import { InstallationRequest } from './entities/installation-request.entity';
import { InstallationRequestsService, InstallationRequestActor } from './installation-requests.service';

/**
 * SPEC-803 escenario 11 (solicitud queda Pendiente; otra pendiente responde 409 INSTALLATION_REQUEST_PENDING),
 * auditoría INSTALLATION_REQUESTED tras el commit, listado y aislamiento por organización.
 */

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const ACTOR: InstallationRequestActor = { organizationId: ORG, userId: 'user-admin' };
const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CREATED_AT = new Date('2026-11-06T10:00:00Z');
const REVIEWED_AT = new Date('2026-11-07T09:00:00Z');

interface StoredRequest {
  requestId: string;
  organizationId: string;
  requestedModel: DeploymentModel;
  status: 'Pendiente' | 'Aprobada' | 'Rechazada' | 'Cerrada';
  requestedBy: string;
  assignedOperator: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

function setup(options: { orgExists?: boolean; stored?: StoredRequest[] } = {}) {
  const stored = options.stored ?? [];
  const state = { committed: false, auditedAfterCommit: null as boolean | null };

  const manager = {
    exists: jest.fn(async (_entity: unknown, query: { where: { organizationId: string; status: string } }) =>
      stored.some(
        (r) => r.organizationId === query.where.organizationId && r.status === query.where.status,
      ),
    ),
    create: jest.fn((_entity: unknown, data: Partial<StoredRequest>) => ({ ...data })),
    save: jest.fn(async (data: Partial<StoredRequest>) => {
      const saved: StoredRequest = {
        requestId: REQUEST_ID,
        createdAt: CREATED_AT,
        reviewedAt: null,
        assignedOperator: null,
        ...data,
      } as StoredRequest;
      stored.push(saved);
      return saved;
    }),
  };

  const dataSource = {
    transaction: jest.fn(async (work: (tx: typeof manager) => Promise<unknown>) => {
      state.committed = false;
      const result = await work(manager);
      state.committed = true;
      return result;
    }),
  };

  const organizations = {
    lockById: jest.fn(async () => options.orgExists ?? true),
  };

  const repository = {
    find: jest.fn(async (query: { where: { organizationId: string } }) =>
      stored
        .filter((r) => r.organizationId === query.where.organizationId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    ),
  };

  const audit = {
    logEvent: jest.fn(async () => {
      state.auditedAfterCommit = state.committed;
    }),
  };

  const service = new InstallationRequestsService(
    dataSource as unknown as DataSource,
    organizations as unknown as OrganizationRepository,
    repository as unknown as Repository<InstallationRequest>,
    audit as unknown as AuditService,
  );

  return { service, stored, state, manager, organizations, repository, audit };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe('InstallationRequestsService (SPEC-803 escenario 11)', () => {
  describe('create', () => {
    it('escenario 11: la solicitud queda en Pendiente y responde { id, status, createdAt }', async () => {
      const { service, stored } = setup();

      const result = await service.create(ACTOR, { requestedModel: DeploymentModel.HYBRID });

      expect(result).toEqual({ id: REQUEST_ID, status: 'Pendiente', createdAt: CREATED_AT.toISOString() });
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        organizationId: ORG,
        requestedModel: 'hybrid',
        status: 'Pendiente',
        requestedBy: 'user-admin',
      });
    });

    it('escenario 11: otra solicitud pendiente de la organización responde 409 INSTALLATION_REQUEST_PENDING', async () => {
      const { service, stored, manager } = setup({
        stored: [
          {
            requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            organizationId: ORG,
            requestedModel: DeploymentModel.ON_PREMISES,
            status: 'Pendiente',
            requestedBy: 'user-admin',
            assignedOperator: null,
            createdAt: CREATED_AT,
            reviewedAt: null,
          },
        ],
      });

      const error = await failure(service.create(ACTOR, { requestedModel: DeploymentModel.CLOUD }));

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(409);
      expect((error as ConflictException).getResponse()).toEqual({
        code: 'INSTALLATION_REQUEST_PENDING',
        message: 'Ya tienes una solicitud de instalación pendiente',
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(stored).toHaveLength(1);
    });

    it('una solicitud ya resuelta (Aprobada) no bloquea una nueva', async () => {
      const { service } = setup({
        stored: [
          {
            requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            organizationId: ORG,
            requestedModel: DeploymentModel.ON_PREMISES,
            status: 'Aprobada',
            requestedBy: 'user-admin',
            assignedOperator: 'Operador',
            createdAt: CREATED_AT,
            reviewedAt: REVIEWED_AT,
          },
        ],
      });

      const result = await service.create(ACTOR, { requestedModel: DeploymentModel.HYBRID });

      expect(result.status).toBe('Pendiente');
    });

    it('una pendiente de OTRA organización no bloquea la solicitud (aislamiento)', async () => {
      const { service } = setup({
        stored: [
          {
            requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            organizationId: OTHER_ORG,
            requestedModel: DeploymentModel.HYBRID,
            status: 'Pendiente',
            requestedBy: 'user-9',
            assignedOperator: null,
            createdAt: CREATED_AT,
            reviewedAt: null,
          },
        ],
      });

      const result = await service.create(ACTOR, { requestedModel: DeploymentModel.HYBRID });

      expect(result.status).toBe('Pendiente');
    });

    it('bloquea la organización antes de comprobar pendientes', async () => {
      const { service, organizations, manager } = setup();

      await service.create(ACTOR, { requestedModel: DeploymentModel.CLOUD });

      expect(organizations.lockById).toHaveBeenCalledWith(expect.anything(), ORG);
      expect(organizations.lockById.mock.invocationCallOrder[0]).toBeLessThan(
        manager.exists.mock.invocationCallOrder[0],
      );
    });

    it('organización inexistente → 404 sin insertar', async () => {
      const { service, manager } = setup({ orgExists: false });

      const error = await failure(service.create(ACTOR, { requestedModel: DeploymentModel.CLOUD }));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('audita INSTALLATION_REQUESTED tras el commit con el id de la solicitud', async () => {
      const { service, state, audit } = setup();

      await service.create(ACTOR, { requestedModel: DeploymentModel.HYBRID });

      expect(audit.logEvent).toHaveBeenCalledTimes(1);
      expect(audit.logEvent).toHaveBeenCalledWith({
        organizationId: ORG,
        actorId: 'user-admin',
        action: AuditAction.INSTALLATION_REQUESTED,
        resourceType: AuditResource.INSTALLATION_REQUEST,
        resourceId: REQUEST_ID,
      });
      expect(state.auditedAfterCommit).toBe(true);
    });

    it('no audita si la solicitud se rechaza por estar pendiente', async () => {
      const { service, audit } = setup({
        stored: [
          {
            requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            organizationId: ORG,
            requestedModel: DeploymentModel.HYBRID,
            status: 'Pendiente',
            requestedBy: 'user-admin',
            assignedOperator: null,
            createdAt: CREATED_AT,
            reviewedAt: null,
          },
        ],
      });

      await failure(service.create(ACTOR, { requestedModel: DeploymentModel.CLOUD }));

      expect(audit.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('devuelve solo las solicitudes de la organización, de la más reciente a la más antigua', async () => {
      const older: StoredRequest = {
        requestId: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        organizationId: ORG,
        requestedModel: DeploymentModel.ON_PREMISES,
        status: 'Rechazada',
        requestedBy: 'user-admin',
        assignedOperator: 'Operador',
        createdAt: new Date('2026-10-01T10:00:00Z'),
        reviewedAt: REVIEWED_AT,
      };
      const newer: StoredRequest = {
        requestId: '22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        organizationId: ORG,
        requestedModel: DeploymentModel.HYBRID,
        status: 'Pendiente',
        requestedBy: 'user-admin',
        assignedOperator: null,
        createdAt: CREATED_AT,
        reviewedAt: null,
      };
      const foreign: StoredRequest = { ...newer, requestId: '33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa', organizationId: OTHER_ORG };
      const { service, repository } = setup({ stored: [older, newer, foreign] });

      const result = await service.list(ACTOR);

      expect(repository.find).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: ORG } }));
      expect(result).toEqual({
        items: [
          {
            id: newer.requestId,
            requestedModel: 'hybrid',
            status: 'Pendiente',
            createdAt: CREATED_AT.toISOString(),
            reviewedAt: null,
          },
          {
            id: older.requestId,
            requestedModel: 'on_premises',
            status: 'Rechazada',
            createdAt: older.createdAt.toISOString(),
            reviewedAt: REVIEWED_AT.toISOString(),
          },
        ],
      });
    });

    it('no expone el solicitante ni el operador asignado', async () => {
      const { service } = setup({
        stored: [
          {
            requestId: '44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            organizationId: ORG,
            requestedModel: DeploymentModel.CLOUD,
            status: 'Pendiente',
            requestedBy: 'secreto-solicitante',
            assignedOperator: 'operador-interno',
            createdAt: CREATED_AT,
            reviewedAt: null,
          },
        ],
      });

      const text = JSON.stringify(await service.list(ACTOR));

      expect(text).not.toContain('secreto-solicitante');
      expect(text).not.toContain('operador-interno');
    });
  });
});
