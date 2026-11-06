import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';
import { AuditService } from '../audit/audit.service';
import { DestinationDefaults } from '../files/destination-defaults.service';
import { Destination } from '../files/entities/destination.entity';
import { Role } from '../iam/domain/enums';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { OrganizationRepository } from '../iam/ports/repositories';
import { InstallationRequestsController } from './installation-requests.controller';
import { InstallationRequestsService } from './installation-requests.service';
import { StoragePolicyController } from './storage-policy.controller';
import { StoragePolicyService } from './storage-policy.service';

/**
 * SPEC-803 escenarios 1 y 12 por HTTP, y contrato de §5 para las rutas de política y solicitudes.
 * Pipes de producción (whitelist + forbidNonWhitelisted + transform) y filtro real. El guard JWT se sustituye
 * por uno que fija el usuario de la prueba; RolesGuard es el real. El servicio de política es el real, con
 * repositorios simulados, para que la respuesta salga de su mapeo de verdad.
 */

const ORG = 'org-1';
const USER = 'user-1';
const CLOUD_ID = '11111111-1111-4111-8111-111111111111';
const LOCAL_ID = '22222222-2222-4222-8222-222222222222';
const SECRET_ENDPOINT = 'https://secreto-endpoint.ejemplo.test:9000';
const SECRET_ACCESS = 'clave-acceso-no-debe-salir';
const SECRET_KEY = 'clave-secreta-no-debe-salir';
const SECRET_CIPHER = 'cifrado-no-debe-salir';
const SECRET_BUCKET = 'bucket-no-debe-salir';

/** Filas con datos sensibles: la respuesta de la política no debe contener ninguno. */
const destinations = [
  {
    id: CLOUD_ID,
    organizationId: ORG,
    name: 'Nube',
    location: 'cloud',
    providerType: 's3',
    connectionStatus: 'Conectado',
    isEnabled: true,
    isDefault: true,
    bucketOrPrefix: SECRET_BUCKET,
    connectionDetailsEncrypted: SECRET_CIPHER,
    endpoint: SECRET_ENDPOINT,
    accessKey: SECRET_ACCESS,
    secretKey: SECRET_KEY,
    createdAt: new Date('2026-11-06T10:00:00Z'),
    updatedAt: null,
  },
  {
    id: LOCAL_ID,
    organizationId: ORG,
    name: 'Local',
    location: 'on_premises',
    providerType: 'minio',
    connectionStatus: 'Conectado',
    isEnabled: true,
    isDefault: false,
    bucketOrPrefix: SECRET_BUCKET,
    connectionDetailsEncrypted: SECRET_CIPHER,
    createdAt: new Date('2026-11-06T10:05:00Z'),
    updatedAt: null,
  },
] as unknown as Destination[];

describe('Rutas de la política de almacenamiento y solicitudes (SPEC-803) por HTTP', () => {
  let app: INestApplication;
  let currentRole: Role;

  /** Modelo vigente de la organización de prueba: lo que el PUT cambia, el GET lo refleja. */
  let currentModel: string;
  const organizations = {
    lockById: jest.fn(async () => true),
    findDeploymentModel: jest.fn(async () => currentModel),
    updateDeploymentModel: jest.fn(async (_tx: unknown, _org: string, model: string) => {
      currentModel = model;
    }),
  };
  /** Predeterminado vigente: lo que promoteToDefault cambia y getDefault refleja. */
  let currentDefaultId: string;
  const destinationDefaults = {
    listAvailable: jest.fn(async () => destinations),
    getDefault: jest.fn(async () => destinations.find((d) => d.id === currentDefaultId) ?? null),
    promoteToDefault: jest.fn(async (_tx: unknown, _org: string, id: string) => {
      currentDefaultId = id;
    }),
  };
  const dataSource = {
    manager: {},
    transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work({})),
  };
  const installationRequests = {
    create: jest.fn().mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'Pendiente',
      createdAt: '2026-11-06T10:00:00.000Z',
    }),
    list: jest.fn().mockResolvedValue({ items: [] }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StoragePolicyController, InstallationRequestsController],
      providers: [
        StoragePolicyService,
        { provide: DataSource, useValue: dataSource },
        { provide: OrganizationRepository, useValue: organizations },
        { provide: DestinationDefaults, useValue: destinationDefaults },
        { provide: AuditService, useValue: { logEvent: jest.fn() } },
        { provide: InstallationRequestsService, useValue: installationRequests },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
          context.switchToHttp().getRequest().user = {
            userId: USER,
            organizationId: ORG,
            role: currentRole,
            email: 'prueba@ejemplo.test',
            fullName: 'Prueba',
            organizationName: 'Organización de prueba',
          };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    currentRole = Role.TENANT_ADMIN;
    currentModel = 'cloud';
    currentDefaultId = CLOUD_ID;
  });

  const putBody = { model: 'on_premises', defaultDestinationId: LOCAL_ID };

  describe('escenario 12: solo tenant_admin cambia el modelo y gestiona solicitudes', () => {
    it('un colaborador recibe 403 FORBIDDEN_ROLE en PUT y en POST/GET de solicitudes, y no llega al servicio', async () => {
      currentRole = Role.COLABORADOR;
      const server = app.getHttpServer();

      const responses = await Promise.all([
        request(server).put('/organizations/storage-policy').send(putBody),
        request(server).post('/organizations/installation-requests').send({ requestedModel: 'hybrid' }),
        request(server).get('/organizations/installation-requests'),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('FORBIDDEN_ROLE');
      }
      expect(organizations.lockById).not.toHaveBeenCalled();
      expect(installationRequests.create).not.toHaveBeenCalled();
      expect(installationRequests.list).not.toHaveBeenCalled();
    });

    it('tenant_admin cambia el modelo y recibe la política resultante', async () => {
      const response = await request(app.getHttpServer())
        .put('/organizations/storage-policy')
        .send(putBody)
        .expect(200);

      expect(response.body.model).toBe('on_premises');
      expect(response.body.defaultDestinationId).toBe(LOCAL_ID);
      expect(organizations.updateDeploymentModel).toHaveBeenCalledTimes(1);
      expect(destinationDefaults.promoteToDefault).toHaveBeenCalledWith(expect.anything(), ORG, LOCAL_ID);
    });

    it('tenant_admin crea y lista solicitudes', async () => {
      const server = app.getHttpServer();

      const created = await request(server)
        .post('/organizations/installation-requests')
        .send({ requestedModel: 'hybrid' })
        .expect(201);
      await request(server).get('/organizations/installation-requests').expect(200);

      expect(created.body).toEqual({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'Pendiente',
        createdAt: '2026-11-06T10:00:00.000Z',
      });
      expect(installationRequests.create).toHaveBeenCalledWith(
        { organizationId: ORG, userId: USER },
        { requestedModel: 'hybrid' },
      );
      expect(installationRequests.list).toHaveBeenCalledWith({ organizationId: ORG, userId: USER });
    });
  });

  describe('escenario 1: cualquier miembro consulta la política, sin credenciales', () => {
    it('un colaborador recibe 200 en GET y la respuesta no contiene endpoint, bucket ni credenciales', async () => {
      currentRole = Role.COLABORADOR;

      const response = await request(app.getHttpServer()).get('/organizations/storage-policy').expect(200);

      expect(response.body).toEqual({
        model: 'cloud',
        defaultDestinationId: CLOUD_ID,
        destinations: [
          { id: CLOUD_ID, name: 'Nube', location: 'cloud' },
          { id: LOCAL_ID, name: 'Local', location: 'on_premises' },
        ],
      });
      const text = JSON.stringify(response.body);
      for (const forbidden of [
        'endpoint',
        'bucket',
        'accessKey',
        'secretKey',
        'connectionDetailsEncrypted',
        SECRET_ENDPOINT,
        SECRET_ACCESS,
        SECRET_KEY,
        SECRET_CIPHER,
        SECRET_BUCKET,
      ]) {
        expect(text).not.toContain(forbidden);
      }
    });
  });

  describe('validación de entrada: solo los campos del contrato', () => {
    it('PUT con un campo extra (organizationId en el cuerpo) responde 400 y no llega al servicio', async () => {
      const response = await request(app.getHttpServer())
        .put('/organizations/storage-policy')
        .send({ ...putBody, organizationId: 'otra-org' })
        .expect(400);

      expect(JSON.stringify(response.body)).not.toContain('otra-org');
      expect(organizations.lockById).not.toHaveBeenCalled();
    });

    it('PUT con un modelo fuera del enum responde 400', async () => {
      await request(app.getHttpServer())
        .put('/organizations/storage-policy')
        .send({ model: 'mixto', defaultDestinationId: LOCAL_ID })
        .expect(400);

      expect(organizations.lockById).not.toHaveBeenCalled();
    });

    it('POST de solicitud con un campo extra responde 400 y no llega al servicio', async () => {
      await request(app.getHttpServer())
        .post('/organizations/installation-requests')
        .send({ requestedModel: 'hybrid', organizationId: 'otra-org' })
        .expect(400);

      expect(installationRequests.create).not.toHaveBeenCalled();
    });
  });
});
