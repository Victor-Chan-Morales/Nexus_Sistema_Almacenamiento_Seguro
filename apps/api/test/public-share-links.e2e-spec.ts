import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';

describe('SPEC-216 con PostgreSQL y SeaweedFS', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => { await app?.close(); });

  it('entrega los bytes de la versión fijada y corta el acceso al revocar', async () => {
    const http = () => request(app.getHttpServer());
    const email = `spec216-${randomUUID()}@test.com`;
    const password = 'NexusTest123';
    await http().post('/api/auth/register')
      .send({ fullName: 'Prueba SPEC-216', email, password, organizationName: 'Prueba enlaces' }).expect(201);
    await app.get(DataSource).query('UPDATE iam."user" SET email_verified = true WHERE email = $1', [email]);
    const login = await http().post('/api/auth/login').send({ email, password }).expect(200);
    const authorization = `Bearer ${login.body.accessToken as string}`;
    const catalog = await http().get('/api/plans').expect(200);
    const plans = catalog.body.items as { id: string; priceMonthly: number }[];
    const plan = plans.find((item) => item.priceMonthly === 0);
    expect(plan).toBeDefined();
    await http().post('/api/subscriptions/activate').set('Authorization', authorization)
      .send({ planId: plan?.id }).expect(201);
    const folders = await http().get('/api/folders').set('Authorization', authorization).expect(200);
    const rootId = folders.body.drive.rootFolderId as string;
    const original = Buffer.from('versión original');
    const upload = (bytes: Buffer) => http().post('/api/files/upload')
      .set('Authorization', authorization).set('Idempotency-Key', randomUUID())
      .field('folderId', rootId)
      .attach('file', bytes, { filename: 'evidencia.txt', contentType: 'text/plain' }).expect(201);
    const first = await upload(original);
    const fileId = first.body.id as string;
    const management = `/api/files/${fileId}/share-links`;
    await http().get(management).expect(401);
    const created = await http().post(management).set('Authorization', authorization)
      .send({ expiresInDays: 1 }).expect(201);
    const second = await upload(Buffer.from('versión posterior más larga'));
    expect(second.body.id).toBe(fileId);
    expect(second.body.versionId).not.toBe(first.body.versionId);
    const url = `/api/public/share-links/${created.body.token as string}`;
    const metadata = await http().get(url).expect(200);
    expect(metadata.body).toMatchObject({ requiresPassword: false, sizeBytes: original.length });
    const response = await http().post(url + '/download').expect(200);
    expect(response.body).toEqual(original);
    await http().delete(`/api/share-links/${created.body.id as string}`)
      .set('Authorization', authorization).expect(204);
    await http().get(url).expect(404).expect(/SHARE_LINK_UNAVAILABLE/);
    await http().post(url + '/download').expect(404).expect(/SHARE_LINK_UNAVAILABLE/);

    const protectedLink = await http().post(management).set('Authorization', authorization)
      .send({ expiresInDays: 1, password: 'EnlacePrueba123' }).expect(201);
    await http().post(`/api/public/share-links/${protectedLink.body.token as string}/download`)
      .send({ password: 'incorrecta' }).expect(401).expect(/SHARE_LINK_PASSWORD_INVALID/);
    const events: unknown = await app.get(DataSource).query(
      `SELECT actor_type, actor_id, result, safe_reason
       FROM audit.audit_event
       WHERE action_type = 'SHARE_LINK_ACCESSED' AND resource_id IN ($1, $2)
       ORDER BY result::text`,
      [created.body.id, protectedLink.body.id],
    );
    expect(events).toEqual([
      { actor_type: 'visitor', actor_id: null, result: 'failure', safe_reason: null },
      { actor_type: 'visitor', actor_id: null, result: 'success', safe_reason: null },
    ]);
  }, 30000);
});
