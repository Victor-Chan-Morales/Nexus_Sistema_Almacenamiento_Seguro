import { INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';
import { Role } from '../iam/domain/enums';
import { DestinationsController } from './destinations.controller';
import { DestinationsService } from './destinations.service';

/**
 * SPEC-802 escenario 9 y riesgo de la spec: rutas HTTP de destinos con las pipes y el filtro de producción.
 * El guard JWT se sustituye por uno que fija el rol de la prueba; RolesGuard es el real.
 */

const ORG = 'org-1';
const USER = 'user-1';
const DESTINATION_ID = '11111111-1111-4111-8111-111111111111';
const SECRET = 'secreto-de-ruta-no-debe-salir';
const ACCESS = 'clave-de-ruta-no-debe-salir';

const validBody = {
  name: 'Respaldo',
  location: 'cloud',
  providerType: 's3',
  endpoint: 'https://almacen.ejemplo.test:9000',
  bucket: 'respaldo',
  region: 'us-east-1',
  accessKey: ACCESS,
  secretKey: SECRET,
  useSsl: true,
};

describe('Rutas de destinos (SPEC-802) por HTTP', () => {
  let app: INestApplication;
  let currentRole: Role;
  const service = {
    create: jest.fn().mockResolvedValue({ id: DESTINATION_ID }),
    list: jest.fn().mockResolvedValue({ items: [] }),
    update: jest.fn().mockResolvedValue({ id: DESTINATION_ID }),
    testConnection: jest.fn().mockResolvedValue({ status: 'Conectado', checkedAt: '2026-11-06T00:00:00.000Z', reason: null }),
  };

  beforeAll(async () => {
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, DestinationsController) ?? [];
    const moduleRef = await Test.createTestingModule({
      controllers: [DestinationsController],
      providers: [{ provide: DestinationsService, useValue: service }],
    })
      .overrideGuard(guards[0] as never)
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
  });

  describe('escenario 9: solo tenant_admin', () => {
    it('un colaborador recibe 403 FORBIDDEN_ROLE en cada ruta y no llega al servicio', async () => {
      currentRole = Role.COLABORADOR;
      const server = app.getHttpServer();

      const responses = await Promise.all([
        request(server).post('/destinations').send(validBody),
        request(server).get('/destinations'),
        request(server).patch(`/destinations/${DESTINATION_ID}`).send({ name: 'Otro' }),
        request(server).post(`/destinations/${DESTINATION_ID}/test`),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('FORBIDDEN_ROLE');
      }
      expect(service.create).not.toHaveBeenCalled();
      expect(service.list).not.toHaveBeenCalled();
      expect(service.update).not.toHaveBeenCalled();
      expect(service.testConnection).not.toHaveBeenCalled();
    });

    it('tenant_admin sí llega al servicio en las mismas rutas', async () => {
      await request(app.getHttpServer()).post('/destinations').send(validBody).expect(201);
      await request(app.getHttpServer()).get('/destinations').expect(200);

      expect(service.create).toHaveBeenCalledTimes(1);
      expect(service.list).toHaveBeenCalledTimes(1);
    });
  });

  describe('riesgo de la spec: las credenciales no salen en errores de validación', () => {
    it('un campo no declarado junto con credenciales responde 400 sin reflejar ningún valor', async () => {
      const response = await request(app.getHttpServer())
        .post('/destinations')
        .send({ ...validBody, endpoint: 'no-es-url', organizationId: 'otra-org' })
        .expect(400);

      const text = JSON.stringify(response.body);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(ACCESS);
      expect(text).not.toContain('otra-org');
      expect(service.create).not.toHaveBeenCalled();
    });

    it('una secretKey fuera de rango responde 400 sin reflejar la secretKey enviada', async () => {
      const tooLong = 'x'.repeat(600);

      const response = await request(app.getHttpServer())
        .post('/destinations')
        .send({ ...validBody, secretKey: tooLong })
        .expect(400);

      expect(JSON.stringify(response.body)).not.toContain(tooLong);
      expect(service.create).not.toHaveBeenCalled();
    });
  });
});
