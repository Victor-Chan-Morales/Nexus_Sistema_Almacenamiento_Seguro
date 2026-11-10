import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';

describe('SPEC-211: renombrar y mover en PostgreSQL', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => { await app?.close(); });

  it('preserva la versión y el enlace y evita ciclos al mover dos carpetas simultáneamente', async () => {
    const email = `spec211-${randomUUID()}@test.com`;
    const password = 'Password123';
    await http().post('/api/auth/register')
      .send({ email, password, fullName: 'Administrador de prueba', organizationName: 'Organizador de prueba' }).expect(201);
    const db = app.get(DataSource);
    await db.query('UPDATE iam."user" SET email_verified=true WHERE email=$1', [email]);
    const login = await http().post('/api/auth/login').send({ email, password }).expect(200);
    const auth = `Bearer ${login.body.accessToken as string}`;
    const folders = await http().get('/api/folders').set('Authorization', auth).expect(200);
    const root = folders.body.drive.rootFolderId as string;
    const create = (name: string) => http().post('/api/folders').set('Authorization', auth)
      .send({ name, parentFolderId: root }).expect(201);
    const source = (await create('Origen')).body.id as string;
    const target = (await create('Destino')).body.id as string;
    const other = (await create('Ocupada')).body.id as string;
    const organize = (id: string, body: { name?: unknown; parentId?: string }) =>
      http().patch(`/api/folders/${id}`).set('Authorization', auth).send(body);
    await organize(root, { name: 'Raíz inválida' }).expect(422).expect(/RESOURCE_NOT_MOVABLE/);
    await organize(source, {}).expect(400).expect(/VALIDATION_ERROR/);
    await organize(source, { name: null }).expect(400).expect(/VALIDATION_ERROR/);
    await organize(source, { name: '  OCUPADA  ' }).expect(409).expect(/FOLDER_NAME_CONFLICT/);
    await organize(source, { parentId: source }).expect(422).expect(/FOLDER_CYCLE_NOT_ALLOWED/);
    const renamed = await organize(other, { name: 'ocupada' }).expect(200);
    expect(renamed.body).toMatchObject({ id: other, name: 'ocupada', parentFolderId: root });

    const catalog = await http().get('/api/plans').expect(200);
    const plan = (catalog.body.items as Array<{ id: string; priceMonthly: number }>).find((item) => item.priceMonthly === 0);
    await http().post('/api/subscriptions/activate').set('Authorization', auth).send({ planId: plan?.id }).expect(201);
    const bytes = Buffer.from('Contenido original');
    const upload = await http().post('/api/files/upload').set('Authorization', auth)
      .set('Idempotency-Key', randomUUID()).field('folderId', source)
      .attach('file', bytes, { filename: 'original.txt', contentType: 'text/plain' }).expect(201);
    const fileId = upload.body.id as string;
    const link = await http().post(`/api/files/${fileId}/share-links`).set('Authorization', auth)
      .send({ expiresInDays: 1 }).expect(201);
    const file = await http().patch(`/api/files/${fileId}`).set('Authorization', auth)
      .send({ name: '  nuevo.txt  ', folderId: target }).expect(200);
    expect(file.body).toMatchObject({ id: fileId, name: 'nuevo.txt', versionId: upload.body.versionId });
    const items = await http().get(`/api/folders/${target}/items`).set('Authorization', auth).expect(200);
    expect(items.body.files).toContainEqual(expect.objectContaining({ id: fileId, name: 'nuevo.txt' }));
    const shared = await http().post(`/api/public/share-links/${link.body.token as string}/download`).expect(200);
    expect(shared.body).toEqual(bytes);

    const outcomes = await Promise.all([organize(source, { parentId: target }), organize(target, { parentId: source })]);
    expect(outcomes.map(({ status }) => status).sort()).toEqual([200, 422]);
    expect(outcomes.find(({ status }) => status === 422)?.body).toMatchObject({ code: 'FOLDER_CYCLE_NOT_ALLOWED' });
    const parents = await db.query<{ folder_id: string; parent_folder_id: string }[]>(
      'SELECT folder_id, parent_folder_id FROM files.folder WHERE folder_id IN ($1, $2)', [source, target],
    );
    expect(parents.filter((row) => row.parent_folder_id === root)).toHaveLength(1);
    const audit = await db.query<{ action_type: string; safe_reason: string | null }[]>(
      "SELECT action_type, safe_reason FROM audit.audit_event WHERE resource_id=$1 AND action_type IN ('FILE_RENAMED','FILE_MOVED') ORDER BY action_type",
      [fileId],
    );
    expect(audit).toEqual([{ action_type: 'FILE_MOVED', safe_reason: null }, { action_type: 'FILE_RENAMED', safe_reason: null }]);
  }, 30000);
});
