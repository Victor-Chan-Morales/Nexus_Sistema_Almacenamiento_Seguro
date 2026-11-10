import { HttpException, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { DeploymentModel, OrgStatus, Role } from '../iam/domain/enums';
import { Organization } from '../iam/entities/organization.entity';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { OrganizationRepository } from '../iam/ports/repositories';
import { SessionService } from '../iam/services/session.service';
import { Installation, InstallationStatus } from './entities/installation.entity';
import { InstallationRequest, InstallationRequestStatus } from './entities/installation-request.entity';
import { PlatformActionsService } from './platform-actions.service';

/**
 * SPEC-503 §4 (escenarios 1 a 10) y §10: pruebas unitarias con mocks del DataSource, de las repositorios,
 * de la sesión y de la auditoría. Las transacciones se simulan con una bandera `open` para comprobar que
 * las revocaciones ocurren dentro de la transacción y que la auditoría ocurre después del commit.
 */

const PLATFORM_ORG = 'org-plataforma';
const CLIENT_ORG = 'org-cliente';
const OTHER_CLIENT_ORG = 'org-otra';

const SUPER_ADMIN: AuthUser = {
  userId: 'user-super-admin',
  organizationId: PLATFORM_ORG,
  role: Role.TENANT_ADMIN,
  email: 'superadmin@plataforma.test',
  fullName: 'Super Admin de Prueba',
  organizationName: 'Plataforma',
  isSuperAdmin: true,
};

const REQ_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQ_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQ_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NEW_INSTALLATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const INSTALLATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const NOW = new Date('2026-11-10T12:00:00Z');

interface OrgRow {
  id: string;
  name: string;
  status: string;
  deploymentModel: DeploymentModel;
}

interface RequestRow {
  requestId: string;
  organizationId: string;
  requestedModel: DeploymentModel;
  status: InstallationRequestStatus;
  requestedBy: string;
  assignedOperator: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

interface InstallationRow {
  installationId: string;
  organizationId: string;
  requestId: string;
  deploymentModel: DeploymentModel;
  status: InstallationStatus;
  hostReference: string | null;
  operatorName: string;
  installedVersion: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}

function org(id: string, name: string, status: string): OrgRow {
  return { id, name, status, deploymentModel: DeploymentModel.CLOUD };
}

function request(overrides: Partial<RequestRow> & { requestId: string }): RequestRow {
  return {
    organizationId: CLIENT_ORG,
    requestedModel: DeploymentModel.ON_PREMISES,
    status: 'Pendiente',
    requestedBy: 'user-cliente-admin',
    assignedOperator: null,
    createdAt: new Date('2026-11-06T10:00:00Z'),
    reviewedAt: null,
    ...overrides,
  };
}

function installation(overrides: Partial<InstallationRow> & { installationId: string }): InstallationRow {
  return {
    organizationId: CLIENT_ORG,
    requestId: REQ_A,
    deploymentModel: DeploymentModel.ON_PREMISES,
    status: 'Pendiente',
    hostReference: null,
    operatorName: 'Operador Previo',
    installedVersion: null,
    createdAt: new Date('2026-11-07T10:00:00Z'),
    updatedAt: null,
    ...overrides,
  };
}

interface FindQuery {
  where: Record<string, unknown>;
  select?: Record<string, boolean>;
  order?: Record<string, string>;
}

function project(row: object, select?: Record<string, boolean>): Record<string, unknown> {
  if (!select) return { ...row };
  return Object.fromEntries(
    Object.keys(select).map((key) => [key, (row as Record<string, unknown>)[key]]),
  );
}

function setup(seed: { orgs?: OrgRow[]; requests?: RequestRow[]; installations?: InstallationRow[] } = {}) {
  const orgs = seed.orgs ?? [org(CLIENT_ORG, 'Cliente SA', 'active'), org(PLATFORM_ORG, 'Plataforma', 'active')];
  const requests = seed.requests ?? [];
  const installations = seed.installations ?? [];

  /** `open`: hay una transacción abierta. `auditOpen`: estado de la transacción en cada llamada a la auditoría. */
  const state = { open: false, revokeOpen: [] as boolean[], auditOpen: [] as boolean[] };

  const manager = {
    findOne: jest.fn(async (entity: unknown, query: { where: Record<string, string> }) => {
      if (entity === InstallationRequest) {
        return requests.find((r) => r.requestId === query.where.requestId) ?? null;
      }
      if (entity === Installation) {
        return installations.find((i) => i.installationId === query.where.installationId) ?? null;
      }
      throw new Error('entidad inesperada en findOne');
    }),
    update: jest.fn(
      async (entity: unknown, criteria: Record<string, string>, values: Record<string, unknown>) => {
        if (entity === InstallationRequest) {
          const row = requests.find((r) => r.requestId === criteria.requestId);
          if (row) Object.assign(row, values);
          return;
        }
        if (entity === Installation) {
          const row = installations.find((i) => i.installationId === criteria.installationId);
          if (row) Object.assign(row, values);
          return;
        }
        throw new Error('entidad inesperada en update');
      },
    ),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    save: jest.fn(async (data: Record<string, unknown>) => {
      const saved = { installationId: NEW_INSTALLATION_ID, createdAt: NOW, ...data } as InstallationRow;
      installations.push(saved);
      return saved;
    }),
    /** Lecturas fuera de transacción (listado): devuelven solo las columnas pedidas en `select`. */
    find: jest.fn(async (entity: unknown, query: FindQuery) => {
      if (entity === InstallationRequest) {
        const status = query.where.status as string | undefined;
        return requests
          .filter((r) => status === undefined || r.status === status)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((r) => project(r, query.select));
      }
      if (entity === Organization) {
        const ids = (query.where.id as { value: string[] }).value;
        return orgs.filter((o) => ids.includes(o.id)).map((o) => project(o, query.select));
      }
      if (entity === Installation) {
        const ids = (query.where.requestId as { value: string[] }).value;
        return installations.filter((i) => ids.includes(i.requestId)).map((i) => project(i, query.select));
      }
      throw new Error('entidad inesperada en find');
    }),
  };

  const dataSource = {
    manager,
    transaction: jest.fn(async (work: (tx: typeof manager) => Promise<unknown>) => {
      state.open = true;
      try {
        return await work(manager);
      } finally {
        state.open = false;
      }
    }),
  };

  const organizations = {
    findByIdForUpdate: jest.fn(async (id: string) => orgs.find((o) => o.id === id) ?? null),
    setStatus: jest.fn(async (_tx: unknown, id: string, status: string) => {
      const row = orgs.find((o) => o.id === id);
      if (row) row.status = status;
    }),
  };

  const sessions = {
    revokeAllOfOrganization: jest.fn(async () => {
      state.revokeOpen.push(state.open);
    }),
  };

  const audit = {
    logEvent: jest.fn(async () => {
      state.auditOpen.push(state.open);
    }),
  };

  const service = new PlatformActionsService(
    dataSource as unknown as DataSource,
    organizations as unknown as OrganizationRepository,
    sessions as unknown as SessionService,
    audit as unknown as AuditService,
  );

  return { service, manager, dataSource, organizations, sessions, audit, state, orgs, requests, installations };
}

/** Comprueba que la promesa se rechaza con un HttpException del estado y código dados. */
async function expectRejection(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  const error = await promise.then(
    () => {
      throw new Error('se esperaba un error y la operación terminó bien');
    },
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(status);
  expect((error as HttpException).getResponse()).toEqual(expect.objectContaining({ code }));
}

describe('PlatformActionsService (SPEC-503)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('E1 suspender organización', () => {
    it('pasa una organización activa a suspended y responde { id, status }', async () => {
      const { service, orgs } = setup();

      const result = await service.suspendOrganization(SUPER_ADMIN, CLIENT_ORG);

      expect(result).toEqual({ id: CLIENT_ORG, status: 'suspended' });
      expect(orgs.find((o) => o.id === CLIENT_ORG)?.status).toBe('suspended');
    });

    it('revoca las sesiones dentro de la misma transacción que el cambio de estado', async () => {
      const { service, manager, organizations, sessions, state } = setup();

      await service.suspendOrganization(SUPER_ADMIN, CLIENT_ORG);

      expect(organizations.findByIdForUpdate).toHaveBeenCalledWith(CLIENT_ORG, manager);
      expect(organizations.setStatus).toHaveBeenCalledWith(manager, CLIENT_ORG, OrgStatus.SUSPENDED);
      expect(sessions.revokeAllOfOrganization).toHaveBeenCalledWith(manager, CLIENT_ORG);
      expect(state.revokeOpen).toEqual([true]);
    });

    it('usa una única transacción para bloquear y cambiar el estado', async () => {
      const { service, dataSource, organizations } = setup();

      await service.suspendOrganization(SUPER_ADMIN, CLIENT_ORG);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(organizations.findByIdForUpdate).toHaveBeenCalledTimes(1);
    });

    it('una organización ya suspendida responde 422 INVALID_ORGANIZATION_TRANSITION sin cambios', async () => {
      const { service, organizations, sessions, audit, orgs } = setup({
        orgs: [org(CLIENT_ORG, 'Cliente SA', 'suspended'), org(PLATFORM_ORG, 'Plataforma', 'active')],
      });

      await expectRejection(
        service.suspendOrganization(SUPER_ADMIN, CLIENT_ORG),
        422,
        'INVALID_ORGANIZATION_TRANSITION',
      );
      expect(organizations.setStatus).not.toHaveBeenCalled();
      expect(sessions.revokeAllOfOrganization).not.toHaveBeenCalled();
      expect(audit.logEvent).not.toHaveBeenCalled();
      expect(orgs.find((o) => o.id === CLIENT_ORG)?.status).toBe('suspended');
    });

    it('una organización cancelada no se puede suspender (422)', async () => {
      const { service } = setup({
        orgs: [org(CLIENT_ORG, 'Cliente SA', 'cancelled'), org(PLATFORM_ORG, 'Plataforma', 'active')],
      });

      await expectRejection(
        service.suspendOrganization(SUPER_ADMIN, CLIENT_ORG),
        422,
        'INVALID_ORGANIZATION_TRANSITION',
      );
    });

    it('una organización inexistente responde 404 ORGANIZATION_NOT_FOUND', async () => {
      const { service, sessions, audit } = setup();

      await expectRejection(
        service.suspendOrganization(SUPER_ADMIN, 'org-no-existe'),
        404,
        'ORGANIZATION_NOT_FOUND',
      );
      expect(sessions.revokeAllOfOrganization).not.toHaveBeenCalled();
      expect(audit.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('E2 reactivar organización', () => {
    it.each([OrgStatus.SUSPENDED, OrgStatus.CANCELLED])(
      'pasa de %s a active y responde { id, status: "active" }',
      async (from) => {
        const { service, orgs, organizations, manager } = setup({
          orgs: [org(CLIENT_ORG, 'Cliente SA', from), org(PLATFORM_ORG, 'Plataforma', 'active')],
        });

        const result = await service.reactivateOrganization(SUPER_ADMIN, CLIENT_ORG);

        expect(result).toEqual({ id: CLIENT_ORG, status: 'active' });
        expect(orgs.find((o) => o.id === CLIENT_ORG)?.status).toBe('active');
        expect(organizations.findByIdForUpdate).toHaveBeenCalledWith(CLIENT_ORG, manager);
        expect(organizations.setStatus).toHaveBeenCalledWith(manager, CLIENT_ORG, OrgStatus.ACTIVE);
      },
    );

    it('una organización activa responde 422 INVALID_ORGANIZATION_TRANSITION sin cambios', async () => {
      const { service, organizations, audit } = setup();

      await expectRejection(
        service.reactivateOrganization(SUPER_ADMIN, CLIENT_ORG),
        422,
        'INVALID_ORGANIZATION_TRANSITION',
      );
      expect(organizations.setStatus).not.toHaveBeenCalled();
      expect(audit.logEvent).not.toHaveBeenCalled();
    });

    it('una organización inexistente responde 404 ORGANIZATION_NOT_FOUND', async () => {
      const { service } = setup();

      await expectRejection(
        service.reactivateOrganization(SUPER_ADMIN, 'org-no-existe'),
        404,
        'ORGANIZATION_NOT_FOUND',
      );
    });
  });

  describe('E3 la organización propia del Super Admin', () => {
    it('no se puede suspender: 422 CANNOT_SUSPEND_OWN_ORGANIZATION sin abrir transacción ni cambiar estado', async () => {
      const { service, dataSource, organizations, sessions, audit, orgs } = setup();

      await expectRejection(
        service.suspendOrganization(SUPER_ADMIN, PLATFORM_ORG),
        422,
        'CANNOT_SUSPEND_OWN_ORGANIZATION',
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(organizations.setStatus).not.toHaveBeenCalled();
      expect(sessions.revokeAllOfOrganization).not.toHaveBeenCalled();
      expect(audit.logEvent).not.toHaveBeenCalled();
      expect(orgs.find((o) => o.id === PLATFORM_ORG)?.status).toBe('active');
    });

    it('la comprobación de propia organización va antes que la de estado (D2)', async () => {
      const { service } = setup({
        orgs: [org(CLIENT_ORG, 'Cliente SA', 'active'), org(PLATFORM_ORG, 'Plataforma', 'suspended')],
      });

      await expectRejection(
        service.suspendOrganization(SUPER_ADMIN, PLATFORM_ORG),
        422,
        'CANNOT_SUSPEND_OWN_ORGANIZATION',
      );
    });
  });

  describe('E4 listar solicitudes de instalación', () => {
    const seeded = (): RequestRow[] => [
      request({ requestId: REQ_B, organizationId: OTHER_CLIENT_ORG, createdAt: new Date('2026-11-08T09:00:00Z') }),
      request({ requestId: REQ_A, createdAt: new Date('2026-11-06T10:00:00Z') }),
      request({
        requestId: REQ_C,
        organizationId: OTHER_CLIENT_ORG,
        status: 'Aprobada',
        createdAt: new Date('2026-11-07T11:00:00Z'),
        reviewedAt: new Date('2026-11-09T08:00:00Z'),
      }),
    ];

    it('ordena por createdAt ascendente (D3)', async () => {
      const { service, manager } = setup({
        orgs: [org(CLIENT_ORG, 'Cliente SA', 'active'), org(OTHER_CLIENT_ORG, 'Otra SA', 'active')],
        requests: seeded(),
      });

      const { items } = await service.listInstallationRequests();

      expect(items.map((i) => i.id)).toEqual([REQ_A, REQ_C, REQ_B]);
      expect(manager.find).toHaveBeenCalledWith(
        InstallationRequest,
        expect.objectContaining({ order: { createdAt: 'ASC' } }),
      );
    });

    it('filtra por status cuando se indica', async () => {
      const { service, manager } = setup({
        orgs: [org(CLIENT_ORG, 'Cliente SA', 'active'), org(OTHER_CLIENT_ORG, 'Otra SA', 'active')],
        requests: seeded(),
      });

      const { items } = await service.listInstallationRequests('Aprobada');

      expect(items.map((i) => i.id)).toEqual([REQ_C]);
      expect(manager.find).toHaveBeenCalledWith(
        InstallationRequest,
        expect.objectContaining({ where: { status: 'Aprobada' } }),
      );
    });

    it('devuelve organización, modelo, estado, fechas y organizationName (D4)', async () => {
      const { service } = setup({
        orgs: [org(CLIENT_ORG, 'Cliente SA', 'active')],
        requests: [request({ requestId: REQ_A })],
      });

      const { items } = await service.listInstallationRequests();

      expect(items).toEqual([
        {
          id: REQ_A,
          organizationId: CLIENT_ORG,
          organizationName: 'Cliente SA',
          requestedModel: DeploymentModel.ON_PREMISES,
          status: 'Pendiente',
          createdAt: '2026-11-06T10:00:00.000Z',
          reviewedAt: null,
          installationId: null,
          installationStatus: null,
          operatorName: null,
          hostReference: null,
        },
      ]);
    });

    it('solicitud sin instalación (Pendiente) devuelve los cuatro campos de instalación en null (SPEC-502)', async () => {
      const { service } = setup({
        orgs: [org(CLIENT_ORG, 'Cliente SA', 'active')],
        requests: [request({ requestId: REQ_A, status: 'Pendiente' })],
      });

      const { items } = await service.listInstallationRequests();

      expect(items[0]).toMatchObject({
        id: REQ_A,
        installationId: null,
        installationStatus: null,
        operatorName: null,
        hostReference: null,
      });
    });

    it('solicitud Aprobada con instalación devuelve id, estado, operador y referencia de la instalación (SPEC-502)', async () => {
      const { service } = setup({
        orgs: [org(CLIENT_ORG, 'Cliente SA', 'active')],
        requests: [
          request({
            requestId: REQ_A,
            status: 'Aprobada',
            reviewedAt: new Date('2026-11-07T09:00:00Z'),
          }),
        ],
        installations: [
          installation({
            installationId: INSTALLATION_ID,
            requestId: REQ_A,
            status: 'Pendiente',
            operatorName: 'Ana Operadora',
            hostReference: 'srv-01.cliente.test',
          }),
        ],
      });

      const { items } = await service.listInstallationRequests();

      expect(items[0]).toEqual({
        id: REQ_A,
        organizationId: CLIENT_ORG,
        organizationName: 'Cliente SA',
        requestedModel: DeploymentModel.ON_PREMISES,
        status: 'Aprobada',
        createdAt: '2026-11-06T10:00:00.000Z',
        reviewedAt: '2026-11-07T09:00:00.000Z',
        installationId: INSTALLATION_ID,
        installationStatus: 'Pendiente',
        operatorName: 'Ana Operadora',
        hostReference: 'srv-01.cliente.test',
      });
    });

    it('lista mezclada: cada solicitud recibe solo su propia instalación y una única consulta a instalaciones (SPEC-502)', async () => {
      const { service, manager } = setup({
        orgs: [org(CLIENT_ORG, 'Cliente SA', 'active'), org(OTHER_CLIENT_ORG, 'Otra SA', 'active')],
        requests: [
          request({ requestId: REQ_A, createdAt: new Date('2026-11-06T10:00:00Z') }),
          request({
            requestId: REQ_B,
            organizationId: OTHER_CLIENT_ORG,
            status: 'Rechazada',
            createdAt: new Date('2026-11-07T10:00:00Z'),
            reviewedAt: new Date('2026-11-08T10:00:00Z'),
          }),
          request({
            requestId: REQ_C,
            organizationId: OTHER_CLIENT_ORG,
            status: 'Aprobada',
            createdAt: new Date('2026-11-08T10:00:00Z'),
            reviewedAt: new Date('2026-11-09T10:00:00Z'),
          }),
        ],
        installations: [
          installation({
            installationId: INSTALLATION_ID,
            requestId: REQ_C,
            organizationId: OTHER_CLIENT_ORG,
            status: 'En proceso',
            operatorName: 'Luis Operador',
            hostReference: null,
          }),
        ],
      });

      const { items } = await service.listInstallationRequests();

      expect(items.map((i) => [i.id, i.installationId, i.installationStatus])).toEqual([
        [REQ_A, null, null],
        [REQ_B, null, null],
        [REQ_C, INSTALLATION_ID, 'En proceso'],
      ]);
      expect(items[2]).toMatchObject({ operatorName: 'Luis Operador', hostReference: null });
      const installationCalls = manager.find.mock.calls.filter(([entity]) => entity === Installation);
      expect(installationCalls).toHaveLength(1);
      expect(installationCalls[0][1]).toMatchObject({
        select: { installationId: true, requestId: true, status: true, operatorName: true, hostReference: true },
      });
    });

    it('serializa reviewedAt cuando la solicitud ya fue revisada', async () => {
      const { service } = setup({
        orgs: [org(OTHER_CLIENT_ORG, 'Otra SA', 'active')],
        requests: [
          request({
            requestId: REQ_C,
            organizationId: OTHER_CLIENT_ORG,
            status: 'Rechazada',
            reviewedAt: new Date('2026-11-09T08:00:00Z'),
          }),
        ],
      });

      const { items } = await service.listInstallationRequests();

      expect(items[0].reviewedAt).toBe('2026-11-09T08:00:00.000Z');
      expect(items[0].status).toBe('Rechazada');
    });

    it('nunca pide ni devuelve columnas de usuario ni correos (D4)', async () => {
      const { service, manager } = setup({
        orgs: [org(CLIENT_ORG, 'Cliente SA', 'active')],
        requests: [request({ requestId: REQ_A, assignedOperator: 'Operador Interno' })],
      });

      const { items } = await service.listInstallationRequests();

      const call = (manager.find.mock.calls[0] as unknown[])[1] as { select: Record<string, boolean> };
      expect(Object.keys(call.select)).not.toContain('requestedBy');
      expect(Object.keys(call.select)).not.toContain('assignedOperator');
      expect(JSON.stringify(items)).not.toMatch(/@|requestedBy|assignedOperator|Operador Interno/);
      expect(Object.keys(items[0]).sort()).toEqual(
        [
          'createdAt',
          'hostReference',
          'id',
          'installationId',
          'installationStatus',
          'operatorName',
          'organizationId',
          'organizationName',
          'requestedModel',
          'reviewedAt',
          'status',
        ].sort(),
      );
    });

    it('sin solicitudes devuelve { items: [] } sin consultar organizaciones ni instalaciones', async () => {
      const { service, manager } = setup({ requests: [] });

      await expect(service.listInstallationRequests()).resolves.toEqual({ items: [] });
      expect(manager.find).toHaveBeenCalledTimes(1);
      expect(manager.find).toHaveBeenCalledWith(InstallationRequest, expect.anything());
    });

    it('con filtro de status solo consulta instalaciones de las solicitudes filtradas (SPEC-502)', async () => {
      const { service, manager } = setup({
        orgs: [org(CLIENT_ORG, 'Cliente SA', 'active'), org(OTHER_CLIENT_ORG, 'Otra SA', 'active')],
        requests: seeded(),
        installations: [
          installation({ installationId: INSTALLATION_ID, requestId: REQ_C, organizationId: OTHER_CLIENT_ORG, status: 'Operativa' }),
          installation({ installationId: NEW_INSTALLATION_ID, requestId: REQ_A, status: 'Pendiente' }),
        ],
      });

      const { items } = await service.listInstallationRequests('Aprobada');

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id: REQ_C, installationId: INSTALLATION_ID, installationStatus: 'Operativa' });
      const installationCalls = manager.find.mock.calls.filter(([entity]) => entity === Installation);
      expect(installationCalls).toHaveLength(1);
      const requestIdFilter = installationCalls[0][1].where.requestId as { value: string[] };
      expect(requestIdFilter.value).toEqual([REQ_C]);
    });
  });

  describe('E5 aprobar solicitud', () => {
    it('marca la solicitud Aprobada con reviewedAt y crea la instalación Pendiente con los datos del pedido', async () => {
      const { service, requests, installations } = setup({
        requests: [request({ requestId: REQ_A, requestedModel: DeploymentModel.HYBRID })],
      });

      const result = await service.approveInstallationRequest(SUPER_ADMIN, REQ_A, {
        operatorName: 'Ana Operadora',
        hostReference: 'srv-01.cliente.test',
      });

      expect(result).toEqual({ requestId: REQ_A, installationId: NEW_INSTALLATION_ID });
      expect(requests[0].status).toBe('Aprobada');
      expect(requests[0].reviewedAt).toBeInstanceOf(Date);
      expect(installations).toHaveLength(1);
      expect(installations[0]).toMatchObject({
        organizationId: CLIENT_ORG,
        requestId: REQ_A,
        deploymentModel: DeploymentModel.HYBRID,
        status: 'Pendiente',
        operatorName: 'Ana Operadora',
        hostReference: 'srv-01.cliente.test',
        installedVersion: null,
        updatedAt: null,
      });
    });

    it('sin hostReference guarda null', async () => {
      const { service, installations } = setup({ requests: [request({ requestId: REQ_A })] });

      await service.approveInstallationRequest(SUPER_ADMIN, REQ_A, { operatorName: 'Ana Operadora' });

      expect(installations[0].hostReference).toBeNull();
    });

    it('funciona aunque la organización esté suspendida (D7)', async () => {
      const { service, requests, installations } = setup({
        orgs: [org(CLIENT_ORG, 'Cliente SA', 'suspended'), org(PLATFORM_ORG, 'Plataforma', 'active')],
        requests: [request({ requestId: REQ_A })],
      });

      const result = await service.approveInstallationRequest(SUPER_ADMIN, REQ_A, {
        operatorName: 'Ana Operadora',
      });

      expect(result.installationId).toBe(NEW_INSTALLATION_ID);
      expect(requests[0].status).toBe('Aprobada');
      expect(installations).toHaveLength(1);
    });

    it('funciona aunque la organización esté cancelada (D7)', async () => {
      const { service, installations } = setup({
        orgs: [org(CLIENT_ORG, 'Cliente SA', 'cancelled'), org(PLATFORM_ORG, 'Plataforma', 'active')],
        requests: [request({ requestId: REQ_A })],
      });

      await service.approveInstallationRequest(SUPER_ADMIN, REQ_A, { operatorName: 'Ana Operadora' });

      expect(installations).toHaveLength(1);
    });

    it('bloquea la solicitud con FOR UPDATE dentro de la transacción', async () => {
      const { service, manager } = setup({ requests: [request({ requestId: REQ_A })] });

      await service.approveInstallationRequest(SUPER_ADMIN, REQ_A, { operatorName: 'Ana Operadora' });

      expect(manager.findOne).toHaveBeenCalledWith(InstallationRequest, {
        where: { requestId: REQ_A },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('una solicitud inexistente responde 404 INSTALLATION_REQUEST_NOT_FOUND', async () => {
      const { service, installations, audit } = setup();

      await expectRejection(
        service.approveInstallationRequest(SUPER_ADMIN, REQ_A, { operatorName: 'Ana Operadora' }),
        404,
        'INSTALLATION_REQUEST_NOT_FOUND',
      );
      expect(installations).toHaveLength(0);
      expect(audit.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('E6 rechazar solicitud', () => {
    it('marca la solicitud Rechazada con reviewedAt y no crea instalación', async () => {
      const { service, requests, installations } = setup({ requests: [request({ requestId: REQ_A })] });

      const result = await service.rejectInstallationRequest(SUPER_ADMIN, REQ_A);

      expect(result).toEqual({ requestId: REQ_A, status: 'Rechazada' });
      expect(requests[0].status).toBe('Rechazada');
      expect(requests[0].reviewedAt).toBeInstanceOf(Date);
      expect(installations).toHaveLength(0);
    });

    it('una solicitud inexistente responde 404 INSTALLATION_REQUEST_NOT_FOUND', async () => {
      const { service } = setup();

      await expectRejection(
        service.rejectInstallationRequest(SUPER_ADMIN, REQ_A),
        404,
        'INSTALLATION_REQUEST_NOT_FOUND',
      );
    });
  });

  describe('E7 solicitud ya revisada', () => {
    const REVIEWED: InstallationRequestStatus[] = ['Aprobada', 'Rechazada', 'Cerrada'];

    it.each(REVIEWED)('aprobar una solicitud %s responde 409 REQUEST_ALREADY_REVIEWED sin efectos', async (status) => {
      const { service, requests, installations, audit } = setup({
        requests: [request({ requestId: REQ_A, status })],
      });

      await expectRejection(
        service.approveInstallationRequest(SUPER_ADMIN, REQ_A, { operatorName: 'Ana Operadora' }),
        409,
        'REQUEST_ALREADY_REVIEWED',
      );
      expect(requests[0].status).toBe(status);
      expect(installations).toHaveLength(0);
      expect(audit.logEvent).not.toHaveBeenCalled();
    });

    it.each(REVIEWED)('rechazar una solicitud %s responde 409 REQUEST_ALREADY_REVIEWED sin efectos', async (status) => {
      const { service, requests, installations, audit } = setup({
        requests: [request({ requestId: REQ_A, status })],
      });

      await expectRejection(
        service.rejectInstallationRequest(SUPER_ADMIN, REQ_A),
        409,
        'REQUEST_ALREADY_REVIEWED',
      );
      expect(requests[0].status).toBe(status);
      expect(installations).toHaveLength(0);
      expect(audit.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('E8 avanzar estado de instalación (matriz de 5 x 5)', () => {
    const STATES: InstallationStatus[] = ['No solicitada', 'Pendiente', 'En proceso', 'Operativa', 'Fallida'];
    const VALID: Array<[InstallationStatus, InstallationStatus]> = [
      ['Pendiente', 'En proceso'],
      ['En proceso', 'Operativa'],
      ['En proceso', 'Fallida'],
    ];
    const MATRIX = STATES.flatMap((from) =>
      STATES.map((to) => ({
        from,
        to,
        valid: VALID.some(([f, t]) => f === from && t === to),
      })),
    );

    it.each(MATRIX)('de "$from" a "$to" -> válida: $valid', async ({ from, to, valid }) => {
      const { service, installations, audit } = setup({
        installations: [installation({ installationId: INSTALLATION_ID, status: from })],
      });

      if (valid) {
        await expect(service.updateInstallationStatus(SUPER_ADMIN, INSTALLATION_ID, to)).resolves.toEqual({
          id: INSTALLATION_ID,
          status: to,
        });
        expect(installations[0].status).toBe(to);
        expect(installations[0].updatedAt).toBeInstanceOf(Date);
        expect(audit.logEvent).toHaveBeenCalledTimes(1);
      } else {
        await expectRejection(
          service.updateInstallationStatus(SUPER_ADMIN, INSTALLATION_ID, to),
          422,
          'INVALID_INSTALLATION_TRANSITION',
        );
        expect(installations[0].status).toBe(from);
        expect(installations[0].updatedAt).toBeNull();
        expect(audit.logEvent).not.toHaveBeenCalled();
      }
    });

    it('una instalación inexistente responde 404 INSTALLATION_NOT_FOUND', async () => {
      const { service } = setup();

      await expectRejection(
        service.updateInstallationStatus(SUPER_ADMIN, INSTALLATION_ID, 'En proceso'),
        404,
        'INSTALLATION_NOT_FOUND',
      );
    });
  });

  describe('E10 auditoría', () => {
    it('suspender emite ORGANIZATION_SUSPENDED sobre la organización afectada con el Super Admin como actor', async () => {
      const { service, audit, state } = setup();

      await service.suspendOrganization(SUPER_ADMIN, CLIENT_ORG);

      expect(audit.logEvent).toHaveBeenCalledTimes(1);
      expect(audit.logEvent).toHaveBeenCalledWith({
        organizationId: CLIENT_ORG,
        actorId: SUPER_ADMIN.userId,
        action: AuditAction.ORGANIZATION_SUSPENDED,
        resourceType: AuditResource.ORGANIZATION,
        resourceId: CLIENT_ORG,
      });
      expect(state.auditOpen).toEqual([false]);
    });

    it('reactivar emite ORGANIZATION_REACTIVATED', async () => {
      const { service, audit } = setup({
        orgs: [org(CLIENT_ORG, 'Cliente SA', 'suspended'), org(PLATFORM_ORG, 'Plataforma', 'active')],
      });

      await service.reactivateOrganization(SUPER_ADMIN, CLIENT_ORG);

      expect(audit.logEvent).toHaveBeenCalledTimes(1);
      expect(audit.logEvent).toHaveBeenCalledWith({
        organizationId: CLIENT_ORG,
        actorId: SUPER_ADMIN.userId,
        action: AuditAction.ORGANIZATION_REACTIVATED,
        resourceType: AuditResource.ORGANIZATION,
        resourceId: CLIENT_ORG,
      });
    });

    it('aprobar emite INSTALLATION_REQUEST_APPROVED sobre la organización del pedido', async () => {
      const { service, audit, state } = setup({ requests: [request({ requestId: REQ_A })] });

      await service.approveInstallationRequest(SUPER_ADMIN, REQ_A, { operatorName: 'Ana Operadora' });

      expect(audit.logEvent).toHaveBeenCalledTimes(1);
      expect(audit.logEvent).toHaveBeenCalledWith({
        organizationId: CLIENT_ORG,
        actorId: SUPER_ADMIN.userId,
        action: AuditAction.INSTALLATION_REQUEST_APPROVED,
        resourceType: AuditResource.INSTALLATION_REQUEST,
        resourceId: REQ_A,
      });
      expect(state.auditOpen).toEqual([false]);
    });

    it('rechazar emite INSTALLATION_REQUEST_REJECTED sobre la organización del pedido', async () => {
      const { service, audit } = setup({ requests: [request({ requestId: REQ_A })] });

      await service.rejectInstallationRequest(SUPER_ADMIN, REQ_A);

      expect(audit.logEvent).toHaveBeenCalledTimes(1);
      expect(audit.logEvent).toHaveBeenCalledWith({
        organizationId: CLIENT_ORG,
        actorId: SUPER_ADMIN.userId,
        action: AuditAction.INSTALLATION_REQUEST_REJECTED,
        resourceType: AuditResource.INSTALLATION_REQUEST,
        resourceId: REQ_A,
      });
    });

    it('avanzar instalación emite INSTALLATION_STATUS_CHANGED sobre la organización de la instalación', async () => {
      const { service, audit } = setup({
        installations: [installation({ installationId: INSTALLATION_ID, organizationId: OTHER_CLIENT_ORG, status: 'En proceso' })],
      });

      await service.updateInstallationStatus(SUPER_ADMIN, INSTALLATION_ID, 'Operativa');

      expect(audit.logEvent).toHaveBeenCalledTimes(1);
      expect(audit.logEvent).toHaveBeenCalledWith({
        organizationId: OTHER_CLIENT_ORG,
        actorId: SUPER_ADMIN.userId,
        action: AuditAction.INSTALLATION_STATUS_CHANGED,
        resourceType: AuditResource.INSTALLATION,
        resourceId: INSTALLATION_ID,
      });
    });
  });

  describe('D8 la auditoría es posterior al commit y best-effort', () => {
    it('un rechazo de logEvent no revierte la suspensión ni lanza error al cliente', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { service, audit, orgs } = setup();
      audit.logEvent.mockRejectedValueOnce(new Error('base de auditoría caída'));

      await expect(service.suspendOrganization(SUPER_ADMIN, CLIENT_ORG)).resolves.toEqual({
        id: CLIENT_ORG,
        status: 'suspended',
      });
      expect(orgs.find((o) => o.id === CLIENT_ORG)?.status).toBe('suspended');

      await new Promise((resolve) => setImmediate(resolve));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ORGANIZATION_SUSPENDED'));
    });

    it('un fallo sincrónico de logEvent no revierte la aprobación ni lanza error al cliente', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { service, audit, requests, installations } = setup({ requests: [request({ requestId: REQ_A })] });
      audit.logEvent.mockImplementationOnce(() => {
        throw new Error('fallo inmediato');
      });

      await expect(
        service.approveInstallationRequest(SUPER_ADMIN, REQ_A, { operatorName: 'Ana Operadora' }),
      ).resolves.toEqual({ requestId: REQ_A, installationId: NEW_INSTALLATION_ID });
      expect(requests[0].status).toBe('Aprobada');
      expect(installations).toHaveLength(1);
    });
  });
});
