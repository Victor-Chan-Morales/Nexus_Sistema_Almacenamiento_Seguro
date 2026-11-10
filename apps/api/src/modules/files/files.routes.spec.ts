import { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { Readable } from 'stream';
import * as request from 'supertest';
import { FileVersionsService } from './file-versions.service';
import { FileOrganizerService } from './file-organizer.service';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

/**
 * SPEC-210 (revisión PR 52): rutas HTTP de descargar y restaurar versiones. Usa el controlador real con el
 * encaminamiento y las pipes de Nest; el servicio va simulado y el guard JWT se sustituye por uno que deja pasar.
 */

const ORG = 'org-1';
const USER = 'user-1';
const FILE_ID = '55555555-5555-4555-8555-555555555555';
const VERSION_ID = '66666666-6666-4666-8666-666666666666';
const ACTOR = { organizationId: ORG, userId: USER };

describe('Rutas de versiones (SPEC-210) por HTTP', () => {
  let app: INestApplication;
  const fileVersions = {
    listVersions: jest.fn(),
    downloadVersion: jest.fn(),
    restoreVersion: jest.fn(),
  };

  beforeAll(async () => {
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, FilesController) ?? [];
    const moduleRef = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        { provide: FileOrganizerService, useValue: {} },
        { provide: FilesService, useValue: {} },
        { provide: FileVersionsService, useValue: fileVersions },
      ],
    })
      .overrideGuard(guards[0] as never)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { organizationId: ORG, userId: USER };
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('descargar una versión', () => {
    it('versionId que no es UUID responde 400 sin llegar al servicio', async () => {
      await request(app.getHttpServer())
        .get(`/files/${FILE_ID}/versions/no-es-uuid/download`)
        .expect(400);

      expect(fileVersions.downloadVersion).not.toHaveBeenCalled();
    });

    it('id de archivo que no es UUID responde 400 sin llegar al servicio', async () => {
      await request(app.getHttpServer())
        .get(`/files/no-es-uuid/versions/${VERSION_ID}/download`)
        .expect(400);

      expect(fileVersions.downloadVersion).not.toHaveBeenCalled();
    });

    it('con UUIDs válidos devuelve los bytes con las cabeceras de descarga', async () => {
      fileVersions.downloadVersion.mockResolvedValueOnce({
        stream: Readable.from([Buffer.from('%PDF-1.4 v1')]),
        mimeType: 'application/pdf',
        name: 'informe.pdf',
      });

      const response = await request(app.getHttpServer())
        .get(`/files/${FILE_ID}/versions/${VERSION_ID}/download`)
        .expect(200);

      expect(fileVersions.downloadVersion).toHaveBeenCalledWith(FILE_ID, VERSION_ID, ACTOR);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['content-disposition']).toContain('attachment; filename="informe.pdf"');
      expect(response.body.toString()).toBe('%PDF-1.4 v1');
    });
  });

  describe('restaurar una versión', () => {
    it('versionId que no es UUID responde 400 sin llegar al servicio', async () => {
      await request(app.getHttpServer())
        .post(`/files/${FILE_ID}/versions/no-es-uuid/restore`)
        .expect(400);

      expect(fileVersions.restoreVersion).not.toHaveBeenCalled();
    });

    it('id de archivo que no es UUID responde 400 sin llegar al servicio', async () => {
      await request(app.getHttpServer())
        .post(`/files/no-es-uuid/versions/${VERSION_ID}/restore`)
        .expect(400);

      expect(fileVersions.restoreVersion).not.toHaveBeenCalled();
    });

    it('con UUIDs válidos responde 200 con el cuerpo del contrato', async () => {
      const body = {
        fileId: FILE_ID,
        versionId: '77777777-7777-4777-8777-777777777777',
        versionNumber: 4,
        sizeBytes: 11,
        uploadedAt: '2026-11-05T10:00:00.000Z',
      };
      fileVersions.restoreVersion.mockResolvedValueOnce(body);

      const response = await request(app.getHttpServer())
        .post(`/files/${FILE_ID}/versions/${VERSION_ID}/restore`)
        .expect(200);

      expect(fileVersions.restoreVersion).toHaveBeenCalledWith(FILE_ID, VERSION_ID, ACTOR);
      expect(response.body).toEqual(body);
    });
  });
});
