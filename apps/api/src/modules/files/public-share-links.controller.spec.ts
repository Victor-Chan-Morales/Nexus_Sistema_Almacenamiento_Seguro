import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';
import { AuditService } from '../audit/audit.service';
import { OpaqueTokens, PasswordHasher } from '../iam/ports/security';
import { DriveAccessService } from './drive-access.service';
import { FileVersion } from './entities/file-version.entity';
import { ShareLink } from './entities/share-link.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FileVersionsService } from './file-versions.service';
import { PublicShareLinksController } from './public-share-links.controller';
import { ShareLinksService } from './share-links.service';

describe('Acceso público a enlaces (SPEC-216)', () => {
  const route = '/public/share-links/token-de-prueba';
  const expiresAt = new Date('2099-01-01');
  const file = { name: 'informe".txt', mimeType: 'text/plain', currentVersionId: 'new', isDeleted: false,
    folder: { organizationId: 'org', isDeleted: false } };
  const version = { id: 'fixed', sizeBytes: '3', fileRecord: file };
  const link = { id: 'link', versionId: 'fixed', organizationId: 'org', expiresAt,
    revokedAt: null, passwordHash: null };
  const findLink = jest.fn();
  const findVersion = jest.fn();
  const existsBy = jest.fn();
  const hash = jest.fn(() => 'token-hash');
  const verify = jest.fn(async (_hash: string, password: string) => password === 'correcta');
  const readVersionBytes = jest.fn(async () => Buffer.from('abc'));
  const logEvent = jest.fn(async () => {});
  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();
    findLink.mockResolvedValue(link);
    findVersion.mockResolvedValue(version);
    existsBy.mockResolvedValue(true);
    const module = await Test.createTestingModule({
      controllers: [PublicShareLinksController],
      providers: [
        ShareLinksService,
        { provide: getRepositoryToken(ShareLink), useValue: { findOneBy: findLink } },
        { provide: getRepositoryToken(FileVersion), useValue: { findOne: findVersion } },
        { provide: DataSource, useValue: { getRepository: () => ({ existsBy }) } },
        { provide: DriveAccessService, useValue: {} },
        { provide: OpaqueTokens, useValue: { hash } },
        { provide: PasswordHasher, useValue: { verify } },
        { provide: FileVersionsService, useValue: { readVersionBytes } },
        { provide: AuditService, useValue: { logEvent } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterEach(async () => { await app.close(); });

  it('busca por hash y oculta metadatos cuando el enlace tiene contraseña', async () => {
    await request(app.getHttpServer()).get(route).expect(200, {
      requiresPassword: false, expiresAt: expiresAt.toISOString(), name: file.name,
      sizeBytes: 3, mimeType: 'text/plain',
    });
    expect(findLink).toHaveBeenCalledWith({ tokenHash: 'token-hash' });
    findLink.mockResolvedValue({ ...link, passwordHash: 'hash' });
    await request(app.getHttpServer()).get(route).expect(200, {
      requiresPassword: true, expiresAt: expiresAt.toISOString(),
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('descarga la versión fija sin sesión con cabeceras seguras y auditoría de visitante', async () => {
    findLink.mockResolvedValue({ ...link, passwordHash: 'hash' });
    const response = await request(app.getHttpServer()).post(route + '/download')
      .send({ password: 'correcta' }).expect(200)
      .expect('Referrer-Policy', 'no-referrer').expect('X-Content-Type-Options', 'nosniff')
      .expect('Cache-Control', 'no-store').expect('Content-Disposition', /attachment;.*informe%22.txt/);
    expect(response.body).toEqual(Buffer.from('abc'));
    expect(readVersionBytes).toHaveBeenCalledWith('org', file, version);
    expect(logEvent).toHaveBeenCalledWith({
      organizationId: 'org', actorType: 'visitor', action: 'SHARE_LINK_ACCESSED',
      resourceType: 'share_link', resourceId: 'link', result: 'success',
    });
  });

  it('bloquea el sexto intento incluso con la contraseña correcta', async () => {
    findLink.mockResolvedValue({ ...link, passwordHash: 'hash' });
    for (let attempt = 0; attempt < 5; attempt++) {
      await request(app.getHttpServer()).post(route + '/download')
        .send(attempt === 0 ? {} : { password: 'incorrecta' })
        .expect(401).expect(/SHARE_LINK_PASSWORD_INVALID/);
    }
    await request(app.getHttpServer()).post(route + '/download')
      .send({ password: 'correcta' }).expect(429).expect(/TOO_MANY_ATTEMPTS/);
    expect(readVersionBytes).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledTimes(5);
    expect(logEvent).toHaveBeenLastCalledWith({
      organizationId: 'org', actorType: 'visitor', action: 'SHARE_LINK_ACCESSED',
      resourceType: 'share_link', resourceId: 'link', result: 'failure',
    });
  });

  it('ignora IPs reenviadas sin proxy de confianza y permite verificar tras 15 minutos', async () => {
    const previous = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = 'false';
    const now = jest.spyOn(Date, 'now');
    const start = Date.now();
    now.mockReturnValue(start);
    try {
      findLink.mockResolvedValue({ ...link, passwordHash: 'hash' });
      for (let attempt = 1; attempt <= 5; attempt++) {
        await request(app.getHttpServer()).post(route + '/download')
          .set('X-Forwarded-For', `192.0.2.${attempt}`)
          .send({ password: 'incorrecta' }).expect(401);
      }
      await request(app.getHttpServer()).post(route + '/download')
        .set('X-Forwarded-For', '192.0.2.6')
        .send({ password: 'correcta' }).expect(429);
      now.mockReturnValue(start + 15 * 60 * 1000);
      await request(app.getHttpServer()).post(route + '/download')
        .send({ password: 'correcta' }).expect(200);
    } finally {
      now.mockRestore();
      if (previous === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = previous;
    }
  });

  it('responde con el mismo error para todos los enlaces no disponibles', async () => {
    const check = async () => {
      const response = await request(app.getHttpServer()).get(route).expect(404);
      expect(response.body).toEqual({
        code: 'SHARE_LINK_UNAVAILABLE', message: 'El enlace no está disponible.',
        requestId: expect.any(String),
      });
    };
    await request(app.getHttpServer()).get(route).expect(200);
    findLink.mockResolvedValueOnce({ ...link, revokedAt: new Date() });
    await check();
    findLink.mockResolvedValueOnce({ ...link, expiresAt: new Date(0) });
    await check();
    findLink.mockResolvedValueOnce(null);
    await check();
    findVersion.mockResolvedValueOnce(null);
    await check();
    findVersion.mockResolvedValueOnce({ ...version, fileRecord: { ...file, isDeleted: true } });
    await check();
    findVersion.mockResolvedValueOnce({ ...version, fileRecord: { ...file, folder: { ...file.folder, isDeleted: true } } });
    await check();
    existsBy.mockResolvedValueOnce(false);
    await check();
  });
});
