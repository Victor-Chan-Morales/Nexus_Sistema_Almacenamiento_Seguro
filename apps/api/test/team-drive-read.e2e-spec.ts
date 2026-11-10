import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import * as argon2 from 'argon2';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';

describe('SPEC-222: lectura de Drives de equipo', () => {
  let app: INestApplication;
  const password = 'Password123';
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

  async function login(email: string) {
    const response = await http().post('/api/auth/login').send({ email, password }).expect(200);
    return {
      authorization: `Bearer ${response.body.accessToken as string}`,
      userId: response.body.user.id as string,
    };
  }

  async function createAdmin() {
    const email = `spec222-${randomUUID()}@test.com`;
    await http().post('/api/auth/register')
      .send({ email, password, fullName: 'Administrador de prueba', organizationName: 'Equipo de prueba' }).expect(201);
    await app.get(DataSource).query('UPDATE iam."user" SET email_verified=true WHERE email=$1', [email]);
    return login(email);
  }

  it('separa organizaciones y membresías en todas las lecturas y revoca acceso en la siguiente solicitud', async () => {
    const db = app.get(DataSource);
    const admin = await createAdmin();
    const foreign = await createAdmin();
    const auth = admin.authorization;
    const email = `spec222-member-${randomUUID()}@test.com`;
    await http().post('/api/organizations/members').set('Authorization', auth)
      .send({ email, fullName: 'Colaborador de prueba', role: 'colaborador' }).expect(201);
    await db.query('UPDATE iam."user" SET email_verified=true,password_hash=$2 WHERE email=$1',
      [email, await argon2.hash(password, { type: argon2.argon2id })]);
    const member = await login(email);

    const team = await http().post('/api/teams').set('Authorization', auth).send({ name: 'Equipo Demo' }).expect(201);
    const { id: teamId, driveId } = team.body as { id: string; driveId: string };
    const overview = await http().get('/api/drives').set('Authorization', auth).expect(200);
    const drives = overview.body.items as Array<{ id: string; type: string; rootFolderId: string; myLevel: string }>;
    expect(drives).toHaveLength(2);
    const teamDrive = drives.find((item) => item.id === driveId);
    expect(teamDrive).toMatchObject({ type: 'team', myLevel: 'write' });
    const root = teamDrive!.rootFolderId;
    const personal = await http().get('/api/folders').set('Authorization', auth).expect(200);
    expect(personal.body.drive.id).toBe(drives.find((item) => item.type === 'personal')?.id);
    const catalog = await http().get('/api/plans').expect(200);
    const plan = (catalog.body.items as Array<{ id: string; priceMonthly: number }>).find((item) => item.priceMonthly === 0);
    await http().post('/api/subscriptions/activate').set('Authorization', auth).send({ planId: plan?.id }).expect(201);
    const bytes = Buffer.from('Contenido del equipo');
    const upload = await http().post('/api/files/upload').set('Authorization', auth)
      .set('Idempotency-Key', randomUUID()).field('folderId', personal.body.drive.rootFolderId as string)
      .attach('file', bytes, { filename: 'equipo.txt', contentType: 'text/plain' }).expect(201);
    const fileId = upload.body.id as string;
    const versionId = upload.body.versionId as string;
    // La escritura de Drives de equipo es SPEC-224. Se mueve únicamente este archivo de prueba.
    await db.query('UPDATE files.file SET folder_id=$1 WHERE file_id=$2', [root, fileId]);

    const routes = [
      `/api/folders?driveId=${driveId}`, `/api/folders/${root}/items`,
      `/api/files?folderId=${root}`, `/api/files/trash?driveId=${driveId}`,
      `/api/files/${fileId}/download`, `/api/files/${fileId}/versions`,
      `/api/files/${fileId}/versions/${versionId}/download`,
    ];
    const assertHidden = async (authorization: string) => {
      for (const route of routes) await http().get(route).set('Authorization', authorization).expect(404);
      await http().post(`/api/files/${fileId}/share-links`).set('Authorization', authorization)
        .send({ expiresInDays: 1 }).expect(404);
    };
    await assertHidden(member.authorization);
    await assertHidden(foreign.authorization);

    await http().post(`/api/teams/${teamId}/members`).set('Authorization', auth)
      .send({ userId: member.userId, level: 'read' }).expect(201);
    const visible = await http().get('/api/drives').set('Authorization', member.authorization).expect(200);
    expect(visible.body.items).toContainEqual(expect.objectContaining({ id: driveId, myLevel: 'read' }));
    expect(visible.body.items).toContainEqual(expect.objectContaining({ type: 'personal', myLevel: 'owner' }));
    expect(visible.body.items).not.toContainEqual(expect.objectContaining({ id: personal.body.drive.id }));
    for (const route of routes) {
      const response = await http().get(route).set('Authorization', member.authorization).expect(200);
      if (route.endsWith('/download')) expect(response.text).toBe(bytes.toString());
    }
    let downloadEvents: unknown[] = [];
    for (let attempt = 0; attempt < 20 && downloadEvents.length < 2; attempt++) {
      downloadEvents = await db.query<unknown[]>(
        "SELECT event_id FROM audit.audit_event WHERE actor_id=$1 AND resource_id=$2 AND action_type='FILE_DOWNLOAD'",
        [member.userId, fileId],
      );
      if (downloadEvents.length < 2) await sleep(100);
    }
    expect(downloadEvents).toHaveLength(2);
    await http().post(`/api/files/${fileId}/share-links`).set('Authorization', member.authorization)
      .send({ expiresInDays: 1 }).expect(403).expect(/DRIVE_PERMISSION_DENIED/);
    await http().post('/api/folders').set('Authorization', member.authorization)
      .send({ name: 'No permitido', parentFolderId: root }).expect(404);
    await http().delete(`/api/teams/${teamId}/members/${member.userId}`).set('Authorization', auth).expect(204);
    await assertHidden(member.authorization);
  }, 30000);
});
