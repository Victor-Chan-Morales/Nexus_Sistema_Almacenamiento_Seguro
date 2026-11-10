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

  async function createCollaborator(authorization: string) {
    const email = `spec-team-member-${randomUUID()}@test.com`;
    await http().post('/api/organizations/members').set('Authorization', authorization)
      .send({ email, fullName: 'Colaborador de prueba', role: 'colaborador' }).expect(201);
    await app.get(DataSource).query('UPDATE iam."user" SET email_verified=true,password_hash=$2 WHERE email=$1',
      [email, await argon2.hash(password, { type: argon2.argon2id })]);
    return login(email);
  }

  it('separa organizaciones y membresías en todas las lecturas y revoca acceso en la siguiente solicitud', async () => {
    const db = app.get(DataSource);
    const admin = await createAdmin();
    const foreign = await createAdmin();
    const auth = admin.authorization;
    const member = await createCollaborator(auth);

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
    // Prepara el contenido del equipo sin depender de las rutas de escritura de SPEC-224.
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
      .send({ name: 'No permitido', parentFolderId: root }).expect(403).expect(/DRIVE_PERMISSION_DENIED/);
    await http().delete(`/api/teams/${teamId}/members/${member.userId}`).set('Authorization', auth).expect(204);
    await assertHidden(member.authorization);
  }, 30000);

  it('SPEC-224: diferencia lector, editor y administrador para las escrituras de equipo', async () => {
    const db = app.get(DataSource);
    const admin = await createAdmin();
    const auth = admin.authorization;
    const member = await createCollaborator(auth);
    const memberAuth = member.authorization;
    const team = await http().post('/api/teams').set('Authorization', auth).send({ name: 'Equipo Editor' }).expect(201);
    const { id: teamId, driveId } = team.body as { id: string; driveId: string };
    const folders = await http().get(`/api/folders?driveId=${driveId}`).set('Authorization', auth).expect(200);
    const root = folders.body.drive.rootFolderId as string;
    const otherTeam = await http().post('/api/teams').set('Authorization', auth).send({ name: 'Equipo Ajeno' }).expect(201);
    const otherFolders = await http().get(`/api/folders?driveId=${otherTeam.body.driveId as string}`).set('Authorization', auth).expect(200);
    const otherRoot = otherFolders.body.drive.rootFolderId as string;
    const catalog = await http().get('/api/plans').expect(200);
    const plan = (catalog.body.items as Array<{ id: string; priceMonthly: number }>).find((item) => item.priceMonthly === 0);
    await http().post('/api/subscriptions/activate').set('Authorization', auth).send({ planId: plan?.id }).expect(201);

    const create = (authorization: string, name: string, parentFolderId = root) =>
      http().post('/api/folders').set('Authorization', authorization).send({ name, parentFolderId });
    const upload = (authorization: string, content: string) => http().post('/api/files/upload')
      .set('Authorization', authorization).set('Idempotency-Key', randomUUID()).field('folderId', root)
      .attach('file', Buffer.from(content), { filename: 'edicion.txt', contentType: 'text/plain' });
    const folder = await create(auth, 'En papelera').expect(201);
    const folderId = folder.body.id as string;
    const first = await upload(auth, 'primera').expect(201);
    const { id: fileId, versionId } = first.body as { id: string; versionId: string };
    const fileUrl = `/api/files/${fileId}`;
    const folderUrl = `/api/folders/${folderId}`;

    await http().post(`/api/teams/${teamId}/members`).set('Authorization', auth)
      .send({ userId: member.userId, level: 'read' }).expect(201);
    const denied = (pending: request.Test) => pending.expect(403).expect(/DRIVE_PERMISSION_DENIED/);
    await denied(create(memberAuth, 'No se crea'));
    await denied(upload(memberAuth, 'no se carga'));
    await denied(http().delete(fileUrl).set('Authorization', memberAuth));
    await denied(http().delete(folderUrl).set('Authorization', memberAuth));
    await denied(http().post(`${fileUrl}/versions/${versionId}/restore`).set('Authorization', memberAuth));
    await denied(http().post(`${fileUrl}/share-links`).set('Authorization', memberAuth).send({ expiresInDays: 1 }));
    await http().delete(fileUrl).set('Authorization', auth).expect(200);
    await http().delete(folderUrl).set('Authorization', auth).expect(200);
    await denied(http().post(`${fileUrl}/restore`).set('Authorization', memberAuth));
    await denied(http().post(`${folderUrl}/restore`).set('Authorization', memberAuth));
    await denied(http().delete(`${fileUrl}/purge`).set('Authorization', memberAuth));
    await denied(http().delete(`${folderUrl}/purge`).set('Authorization', memberAuth));

    await http().patch(`/api/teams/${teamId}/members/${member.userId}`).set('Authorization', auth)
      .send({ level: 'write' }).expect(200);
    await create(memberAuth, 'Otro equipo', otherRoot).expect(404);
    const child = await create(memberAuth, 'Creada por editor').expect(201);
    expect(child.body.driveId).toBe(driveId);
    await denied(http().delete(`${fileUrl}/purge`).set('Authorization', memberAuth));
    await denied(http().delete(`${folderUrl}/purge`).set('Authorization', memberAuth));
    await http().post(`${fileUrl}/restore`).set('Authorization', memberAuth).expect(200);
    await http().post(`${folderUrl}/restore`).set('Authorization', memberAuth).expect(200);
    const second = await upload(memberAuth, 'segunda').expect(201);
    expect(second.body.id).toBe(fileId);
    expect(second.body.versionId).not.toBe(versionId);
    await http().post(`${fileUrl}/share-links`).set('Authorization', memberAuth).send({ expiresInDays: 1 }).expect(201);
    const dashboard = await http().get('/api/dashboard').set('Authorization', auth).expect(200);
    expect(dashboard.body.storageUsedBytes).toBe(Buffer.byteLength('primera') + Buffer.byteLength('segunda'));
    expect(await db.query('SELECT uploaded_by FROM files.file_version WHERE file_id=$1 ORDER BY version_number', [fileId]))
      .toEqual([{ uploaded_by: admin.userId }, { uploaded_by: member.userId }]);
    await http().post(`${fileUrl}/versions/${versionId}/restore`).set('Authorization', memberAuth).expect(200);
    await http().delete(fileUrl).set('Authorization', memberAuth).expect(200);
    await http().delete(folderUrl).set('Authorization', memberAuth).expect(200);

    const expected = ['FILE_DELETE', 'FILE_RESTORE', 'FILE_UPLOAD', 'FILE_VERSION_RESTORED', 'FOLDER_CREATE',
      'FOLDER_DELETE', 'FOLDER_RESTORE', 'SHARE_LINK_CREATED'];
    let actions: string[] = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      const rows = await db.query<{ action_type: string }[]>(
        'SELECT DISTINCT action_type FROM audit.audit_event WHERE actor_id=$1 ORDER BY action_type',
        [member.userId],
      );
      actions = rows.map((row) => row.action_type);
      if (!expected.every((action) => actions.includes(action))) await sleep(100);
      else break;
    }
    expect(actions).toEqual(expect.arrayContaining(expected));
    await http().delete(`${fileUrl}/purge`).set('Authorization', auth).expect(200);
    await http().delete(`${folderUrl}/purge`).set('Authorization', auth).expect(200);
  }, 30000);
});
