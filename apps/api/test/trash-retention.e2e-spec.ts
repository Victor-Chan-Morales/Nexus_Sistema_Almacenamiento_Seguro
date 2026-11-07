import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';

import { FilesService } from '../src/modules/files/files.service';
import { TrashRetentionService } from '../src/modules/files/trash-retention.service';
import { StorageRouter } from '../src/modules/storage/storage-router.service';

describe('SPEC-215 con PostgreSQL y SeaweedFS', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Se purgan únicamente los IDs de esta prueba, nunca la papelera general de desarrollo.
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TrashRetentionService).useValue({}).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => { await app?.close(); });

  it('respeta el plazo y el estado de la organización y solo purga una vez con dos ejecuciones', async () => {
    const http = () => request(app.getHttpServer());
    const db = app.get(DataSource);
    const files = app.get(FilesService);
    const email = `spec215-${randomUUID()}@test.com`;
    const password = 'NexusTest123';
    await http().post('/api/auth/register')
      .send({ fullName: 'Prueba SPEC-215', email, password, organizationName: 'Prueba papelera' }).expect(201);
    await db.query('UPDATE iam."user" SET email_verified = true WHERE email = $1', [email]);
    const login = await http().post('/api/auth/login').send({ email, password }).expect(200);
    const organizationId = login.body.organization.id as string;
    const authorization = `Bearer ${login.body.accessToken as string}`;
    const catalog = await http().get('/api/plans').expect(200);
    const plans = catalog.body.items as { id: string; priceMonthly: number }[];
    const plan = plans.find((item) => item.priceMonthly === 0);
    expect(plan).toBeDefined();
    await http().post('/api/subscriptions/activate').set('Authorization', authorization)
      .send({ planId: plan?.id }).expect(201);
    const folders = await http().get('/api/folders').set('Authorization', authorization).expect(200);
    const rootId = folders.body.drive.rootFolderId as string;

    const upload = async (folderId: string, name: string) => {
      const response = await http().post('/api/files/upload')
        .set('Authorization', authorization).set('Idempotency-Key', randomUUID())
        .field('folderId', folderId)
        .attach('file', Buffer.from('abc'), { filename: name, contentType: 'text/plain' }).expect(201);
      return response.body.id as string;
    };
    const storedObject = async (fileId: string) => {
      const [version] = await db.query<{ destination_id: string; object_key: string }[]>(
        'SELECT destination_id, object_key FROM files.file_version WHERE file_id = $1',
        [fileId],
      );
      const storage = await app.get(StorageRouter).forRead(organizationId, version.destination_id);
      const stream = await storage.get(version.object_key);
      stream.destroy();
      return () => storage.get(version.object_key);
    };
    const fileId = await upload(rootId, 'suelto.txt');
    const readFileObject = await storedObject(fileId);
    await http().delete(`/api/files/${fileId}`).set('Authorization', authorization).expect(200);
    await files.purgeExpiredFile(fileId, organizationId);
    expect(await files.getUsedStorageBytes(organizationId)).toBe(3n);
    await db.query("UPDATE files.file SET deleted_at = now() - interval '31 days' WHERE file_id = $1", [fileId]);
    expect(await files.getUsedStorageBytes(organizationId)).toBe(3n);
    await http().post(`/api/files/${fileId}/restore`).set('Authorization', authorization).expect(200);
    await files.purgeExpiredFile(fileId, organizationId);
    expect(await files.getUsedStorageBytes(organizationId)).toBe(3n);
    await http().delete(`/api/files/${fileId}`).set('Authorization', authorization).expect(200);
    await db.query("UPDATE files.file SET deleted_at = now() - interval '31 days' WHERE file_id = $1", [fileId]);
    await db.query("UPDATE admin.organization SET status = 'suspended' WHERE organization_id = $1", [organizationId]);
    try {
      await files.purgeExpiredFile(fileId, organizationId);
      expect(await files.getUsedStorageBytes(organizationId)).toBe(3n);
    } finally {
      await db.query("UPDATE admin.organization SET status = 'active' WHERE organization_id = $1", [organizationId]);
    }
    await Promise.all([
      files.purgeExpiredFile(fileId, organizationId),
      files.purgeExpiredFile(fileId, organizationId),
    ]);
    expect(await files.getUsedStorageBytes(organizationId)).toBe(0n);
    await expect(readFileObject()).rejects.toThrow('Error al recuperar el objeto de Storage');

    const folder = await http().post('/api/folders').set('Authorization', authorization)
      .send({ name: 'Carpeta de prueba', parentFolderId: rootId }).expect(201);
    const folderId = folder.body.id as string;
    const childId = await upload(folderId, 'dentro.txt');
    const readChildObject = await storedObject(childId);
    await http().delete(`/api/folders/${folderId}`).set('Authorization', authorization).expect(200);
    await db.query("UPDATE files.folder SET deleted_at = now() - interval '31 days' WHERE folder_id = $1", [folderId]);
    await files.purgeExpiredFolder(folderId, organizationId);
    expect(await files.getUsedStorageBytes(organizationId)).toBe(0n);
    expect(await db.query('SELECT file_id FROM files.file WHERE file_id IN ($1, $2)', [fileId, childId])).toEqual([]);
    expect(await db.query('SELECT folder_id FROM files.folder WHERE folder_id = $1', [folderId])).toEqual([]);
    await expect(readChildObject()).rejects.toThrow('Error al recuperar el objeto de Storage');
    expect(await db.query(
      `SELECT action_type, actor_type, actor_id FROM audit.audit_event
       WHERE resource_id IN ($1, $2) AND action_type IN ('FILE_PURGE', 'FOLDER_PURGE')
       ORDER BY action_type`, [fileId, folderId],
    )).toEqual([
      { action_type: 'FILE_PURGE', actor_type: 'system', actor_id: null },
      { action_type: 'FOLDER_PURGE', actor_type: 'system', actor_id: null },
    ]);
  }, 30000);
});
