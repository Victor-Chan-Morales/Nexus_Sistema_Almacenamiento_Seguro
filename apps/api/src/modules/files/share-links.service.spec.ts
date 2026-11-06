import { BadRequestException, HttpException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditEventInput, AuditResource } from '../audit/audit.types';
import { Argon2PasswordHasher } from '../iam/infrastructure/argon2-password-hasher';
import { CryptoOpaqueTokens } from '../iam/infrastructure/crypto-opaque-tokens';
import { CreateShareLinkDto } from './dto/share-link.dto';
import { Drive } from './entities/drive.entity';
import { FileRecord } from './entities/file-record.entity';
import { FileVersion } from './entities/file-version.entity';
import { Folder } from './entities/folder.entity';
import { ShareLink } from './entities/share-link.entity';
import { DriveAccessService } from './drive-access.service';
import { ShareLinksService, shareLinkStatus } from './share-links.service';

/** SPEC-209: pruebas unitarias de los enlaces compartidos. Escenarios 1 a 9 de la spec. */

const ORG = 'org-1';
const ORG_2 = 'org-2';
const USER = 'user-1';
const OTHER_USER = 'user-2';
const ACTOR = { organizationId: ORG, userId: USER };
const PASSWORD = 'Clave-Compartida-1';

const DRIVE = { id: 'drive-1', organizationId: ORG, ownerUserId: USER, teamId: null, type: 'personal' };
const DRIVE_OTHER = { id: 'drive-2', organizationId: ORG, ownerUserId: OTHER_USER, teamId: null, type: 'personal' };
const FOLDER = { id: 'folder-1', organizationId: ORG, driveId: 'drive-1', isDeleted: false };
const FOLDER_OTHER = { id: 'folder-2', organizationId: ORG, driveId: 'drive-2', isDeleted: false };
const FILE = {
  id: 'file-1',
  organizationId: ORG,
  folderId: 'folder-1',
  name: 'informe.pdf',
  mimeType: 'application/pdf',
  isDeleted: false,
  currentVersionId: 'v3',
};
const FILE_OTHER_DRIVE = { ...FILE, id: 'file-9', folderId: 'folder-2', currentVersionId: 'x1' };

type LinkRow = ShareLink;

const versionRow = (id: string, fileId: string, versionNumber: number): FileVersion =>
  ({
    id,
    fileId,
    versionNumber,
    destinationId: 'destination-1',
    objectKey: `${ORG}/${fileId}/${id}`,
    sizeBytes: '10',
    checksum: '',
    encryptedDek: '',
    kekId: 'kek-1',
    formatVersion: 1,
    uploadedBy: USER,
    uploadedAt: new Date('2026-10-01T12:00:00.000Z'),
  }) as FileVersion;

const linkRow = (overrides: Partial<LinkRow> & { id: string }): LinkRow =>
  ({
    organizationId: ORG,
    versionId: 'v3',
    tokenHash: 'hash-' + overrides.id,
    passwordHash: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    createdBy: USER,
    createdAt: new Date(Date.now() - 1000),
    ...overrides,
  }) as LinkRow;

/** Repositorio en memoria con la forma que usa el servicio. Los filtros replican los `where` reales. */
const buildFixture = () => {
  const versions: FileVersion[] = [
    versionRow('v1', 'file-1', 1),
    versionRow('v2', 'file-1', 2),
    versionRow('v3', 'file-1', 3),
    versionRow('w1', 'file-9', 1),
    versionRow('x1', 'file-9', 2),
  ];
  const drives = [DRIVE, DRIVE_OTHER];
  const folders = [FOLDER, FOLDER_OTHER];
  const files: FileRecord[] = [{ ...FILE }, { ...FILE_OTHER_DRIVE }] as FileRecord[];
  const links: LinkRow[] = [];

  /** Se ejecuta cada vez que el servicio toma un bloqueo de archivo: permite simular una carrera. */
  const hooks: { onLock?: () => void } = {};

  const driveRepo = {
    findOne: jest.fn(({ where }: { where: { organizationId: string; ownerUserId: string } }) =>
      Promise.resolve(
        drives.find((drive) => drive.organizationId === where.organizationId && drive.ownerUserId === where.ownerUserId) ?? null,
      ),
    ),
  };
  const fileRepo = {
    findOne: jest.fn(({ where, lock }: { where: { id: string; organizationId: string }; lock?: unknown }) => {
      if (lock) hooks.onLock?.();
      return Promise.resolve(files.find((f) => f.id === where.id && f.organizationId === where.organizationId) ?? null);
    }),
  };
  const folderRepo = {
    findOne: jest.fn(({ where }: { where: { id: string; organizationId: string } }) =>
      Promise.resolve(folders.find((f) => f.id === where.id && f.organizationId === where.organizationId) ?? null),
    ),
  };
  const versionRepo = {
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(versions.find((v) => v.id === where.id) ?? null),
    ),
  };

  const linkRepo = {
    create: jest.fn((data: Partial<LinkRow>) => ({ ...data })),
    save: jest.fn(async (data: Partial<LinkRow>) => {
      const row = { id: 'link-' + (links.length + 1), createdAt: new Date(), ...data } as LinkRow;
      links.push(row);
      return row;
    }),
    findOne: jest.fn(({ where }: { where: { id: string; organizationId: string } }) => {
      const row = links.find((l) => l.id === where.id && l.organizationId === where.organizationId);
      return Promise.resolve(row ? { ...row } : null);
    }),
    update: jest.fn(
      async (
        criteria: { id: string; organizationId: string; revokedAt?: unknown },
        partial: { revokedAt: () => string },
      ) => {
        const onlyActive = criteria.revokedAt instanceof FindOperator && criteria.revokedAt.type === 'isNull';
        const row = links.find((l) => l.id === criteria.id && l.organizationId === criteria.organizationId);
        if (!row || (onlyActive && row.revokedAt !== null)) return { affected: 0 };
        expect(partial.revokedAt()).toBe('CURRENT_TIMESTAMP');
        row.revokedAt = new Date();
        return { affected: 1 };
      },
    ),
    /** Imita el join y los filtros de `listLinks`: enlaces de cualquier versión del archivo, de la organización. */
    createQueryBuilder: jest.fn(() => {
      const params: Record<string, string> = {};
      const qb = {
        innerJoin: () => qb,
        select: () => qb,
        where: (_sql: string, p: Record<string, string>) => {
          Object.assign(params, p);
          return qb;
        },
        andWhere: (_sql: string, p: Record<string, string>) => {
          Object.assign(params, p);
          return qb;
        },
        orderBy: () => qb,
        getMany: async () =>
          links
            .filter(
              (l) =>
                l.organizationId === params.organizationId &&
                versions.find((v) => v.id === l.versionId)?.fileId === params.fileId,
            )
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map((l) => ({ ...l })),
      };
      return qb;
    }),
  };

  const repositories = new Map<unknown, unknown>([
    [Drive, driveRepo],
    [FileRecord, fileRepo],
    [Folder, folderRepo],
    [FileVersion, versionRepo],
    [ShareLink, linkRepo],
  ]);
  const manager = { getRepository: (entity: unknown) => repositories.get(entity) };
  const dataSource = {
    getRepository: manager.getRepository,
    transaction: jest.fn(async (callback: (m: typeof manager) => unknown) => callback(manager)),
  };

  const driveAccess = new DriveAccessService(dataSource as never);
  const logEvent = jest.fn<Promise<void>, [AuditEventInput]>().mockResolvedValue(undefined);
  const auditService = { logEvent } as unknown as AuditService;

  const opaque = new CryptoOpaqueTokens();
  const hasher = new Argon2PasswordHasher();
  const service = new ShareLinksService(
    linkRepo as never,
    versionRepo as never,
    dataSource as never,
    driveAccess,
    opaque,
    hasher,
    auditService,
  );

  return { service, links, files, folders, versions, linkRepo, driveAccess, logEvent, hooks, opaque, hasher };
};

/** Fuerza el nivel de acceso de `locateFile` para simular un Drive de solo lectura. */
const withAccessLevel = (driveAccess: DriveAccessService, level: 'read' | 'write' | 'owner') => {
  const original = driveAccess.locateFile.bind(driveAccess);
  jest.spyOn(driveAccess, 'locateFile').mockImplementation(async (actor, fileId, options) => {
    const located = await original(actor, fileId, options);
    return located && { ...located, access: { ...located.access, level } };
  });
};

/** Devuelve el error de una promesa rechazada; falla si se resuelve. */
const failureOf = async (promise: Promise<unknown>): Promise<HttpException> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('Se esperaba un error y la operación se resolvió');
};

const DAY_MS = 86_400_000;

describe('ShareLinksService (SPEC-209)', () => {
  describe('Escenario 1: crear', () => {
    it('responde id, token, versionId vigente, expiresAt a 7 días y hasPassword false', async () => {
      const { service } = buildFixture();
      const before = Date.now();

      const created = await service.createLink('file-1', { expiresInDays: 7 }, ACTOR);

      expect(created.id).toMatch(/^link-/);
      expect(created.token.length).toBeGreaterThanOrEqual(40);
      expect(created.versionId).toBe('v3');
      expect(created.hasPassword).toBe(false);
      const expires = new Date(created.expiresAt).getTime();
      expect(expires).toBeGreaterThanOrEqual(before + 7 * DAY_MS);
      expect(expires).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);
      expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false);
    });

    it('guarda solo el hash del token, nunca el token en claro', async () => {
      const { service, links, opaque } = buildFixture();

      const created = await service.createLink('file-1', { expiresInDays: 1 }, ACTOR);

      expect(links).toHaveLength(1);
      expect(links[0].tokenHash).toBe(opaque.hash(created.token));
      expect(links[0].tokenHash).not.toBe(created.token);
      expect(JSON.stringify(links)).not.toContain(created.token);
    });
  });

  describe('Escenario 2: con contraseña', () => {
    it('guarda solo el hash Argon2id y responde hasPassword true', async () => {
      const { service, links, hasher } = buildFixture();

      const created = await service.createLink('file-1', { expiresInDays: 30, password: PASSWORD }, ACTOR);

      expect(created.hasPassword).toBe(true);
      expect(links[0].passwordHash).toMatch(/^\$argon2id\$/);
      expect(links[0].passwordHash).not.toContain(PASSWORD);
      expect(await hasher.verify(links[0].passwordHash as string, PASSWORD)).toBe(true);
    });

    it('sin contraseña guarda passwordHash null', async () => {
      const { service, links } = buildFixture();

      await service.createLink('file-1', { expiresInDays: 1 }, ACTOR);

      expect(links[0].passwordHash).toBeNull();
    });
  });

  describe('Escenario 3: validación de entrada', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const validate = (value: unknown) => pipe.transform(value, { type: 'body', metatype: CreateShareLinkDto });

    it.each([0, 2, 8, 31, '7', 7.5, null, undefined])('rechaza expiresInDays %p con 400', async (days) => {
      const error = await failureOf(validate({ expiresInDays: days }));
      expect(error).toBeInstanceOf(BadRequestException);
    });

    it.each([1, 7, 30])('acepta expiresInDays %p', async (days) => {
      await expect(validate({ expiresInDays: days })).resolves.toEqual(expect.objectContaining({ expiresInDays: days }));
    });

    it('rechaza una contraseña de 7 o de 129 caracteres', async () => {
      await expect(validate({ expiresInDays: 1, password: 'x'.repeat(7) })).rejects.toBeInstanceOf(BadRequestException);
      await expect(validate({ expiresInDays: 1, password: 'x'.repeat(129) })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('la respuesta de error no refleja la contraseña enviada', async () => {
      const secret = 'Secreta-Corta';
      const error = await failureOf(validate({ expiresInDays: 9, password: secret.slice(0, 7) }));
      expect(JSON.stringify(error.getResponse())).not.toContain(secret.slice(0, 7));
    });

    it('rechaza un campo no declarado como organizationId', async () => {
      await expect(validate({ expiresInDays: 1, organizationId: ORG_2 })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('Escenario 4: el token solo se ve una vez', () => {
    it('el listado no contiene el token, su hash ni la contraseña', async () => {
      const { service, opaque } = buildFixture();
      const created = await service.createLink('file-1', { expiresInDays: 7, password: PASSWORD }, ACTOR);

      const listed = await service.listLinks('file-1', ACTOR);

      const json = JSON.stringify(listed);
      expect(json).not.toContain(created.token);
      expect(json).not.toContain(opaque.hash(created.token));
      expect(json).not.toContain('tokenHash');
      expect(json).not.toContain('passwordHash');
      expect(listed.items[0].hasPassword).toBe(true);
    });
  });

  describe('Escenario 5: listar', () => {
    it('devuelve active, expired y revoked, con el más reciente primero', async () => {
      const { service, links } = buildFixture();
      const now = Date.now();
      links.push(
        linkRow({ id: 'old-active', versionId: 'v1', createdAt: new Date(now - 4000), expiresAt: new Date(now + DAY_MS) }),
        linkRow({ id: 'expired', createdAt: new Date(now - 3000), expiresAt: new Date(now - DAY_MS) }),
        linkRow({
          id: 'revoked',
          createdAt: new Date(now - 2000),
          expiresAt: new Date(now + DAY_MS),
          revokedAt: new Date(now - 1000),
        }),
        linkRow({ id: 'revoked-expired', createdAt: new Date(now - 1500), expiresAt: new Date(now - DAY_MS), revokedAt: new Date(now - 1000) }),
        linkRow({ id: 'recent-active', createdAt: new Date(now - 500), expiresAt: new Date(now + 7 * DAY_MS), passwordHash: '$argon2id$x' }),
      );

      const { items } = await service.listLinks('file-1', ACTOR);

      expect(items.map((item) => item.id)).toEqual(['recent-active', 'revoked-expired', 'revoked', 'expired', 'old-active']);
      expect(items.map((item) => item.status)).toEqual(['active', 'revoked', 'revoked', 'expired', 'active']);
      expect(items[0].hasPassword).toBe(true);
      expect(items[4].versionId).toBe('v1');
      expect(items[2].revokedAt).not.toBeNull();
      expect(items[3].revokedAt).toBeNull();
    });

    it('excluye los enlaces de otro archivo', async () => {
      const { service, links } = buildFixture();
      links.push(linkRow({ id: 'ajeno', versionId: 'x1' }));

      const { items } = await service.listLinks('file-1', ACTOR);

      expect(items).toEqual([]);
    });

    it('las cinco keys del ítem son exactamente las de la spec', async () => {
      const { service, links } = buildFixture();
      links.push(linkRow({ id: 'a' }));

      const [item] = (await service.listLinks('file-1', ACTOR)).items;

      expect(Object.keys(item).sort()).toEqual(
        ['createdAt', 'expiresAt', 'hasPassword', 'id', 'revokedAt', 'status', 'versionId'].sort(),
      );
    });
  });

  describe('Escenario 6: revocar', () => {
    it('registra revokedAt y audita la primera revocación', async () => {
      const { service, links, logEvent } = buildFixture();
      const created = await service.createLink('file-1', { expiresInDays: 1 }, ACTOR);
      logEvent.mockClear();

      await service.revokeLink(created.id, ACTOR);

      expect(links[0].revokedAt).toBeInstanceOf(Date);
      expect(logEvent).toHaveBeenCalledTimes(1);
    });

    it('repetir la revocación no cambia la fecha ni vuelve a auditar', async () => {
      const { service, links, logEvent } = buildFixture();
      const created = await service.createLink('file-1', { expiresInDays: 1 }, ACTOR);
      await service.revokeLink(created.id, ACTOR);
      const firstRevocation = links[0].revokedAt;
      logEvent.mockClear();

      await expect(service.revokeLink(created.id, ACTOR)).resolves.toBeUndefined();

      expect(links[0].revokedAt).toBe(firstRevocation);
      expect(logEvent).not.toHaveBeenCalled();
    });
  });

  describe('Escenario 7: aislamiento', () => {
    it('crear sobre un archivo de otra organización responde 404', async () => {
      const { service, files } = buildFixture();
      files[0] = { ...files[0], organizationId: ORG_2 } as FileRecord;

      await expect(service.createLink('file-1', { expiresInDays: 1 }, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('crear sobre un archivo de otro usuario (otro Drive) responde 404', async () => {
      const { service } = buildFixture();

      await expect(service.createLink('file-9', { expiresInDays: 1 }, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('crear sobre un archivo inexistente responde 404', async () => {
      const { service } = buildFixture();

      await expect(service.createLink('no-existe', { expiresInDays: 1 }, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('listar sobre un archivo ajeno responde 404', async () => {
      const { service } = buildFixture();

      await expect(service.listLinks('file-9', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('revocar un enlace de otra organización o inexistente responde 404', async () => {
      const { service, links } = buildFixture();
      links.push(linkRow({ id: 'ajeno', organizationId: ORG_2 }));

      await expect(service.revokeLink('ajeno', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.revokeLink('no-existe', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(links[0].revokedAt).toBeNull();
    });

    it('revocar un enlace de un archivo de otro usuario responde 404 y no cambia nada', async () => {
      const { service, links } = buildFixture();
      links.push(linkRow({ id: 'ajeno', versionId: 'x1' }));

      await expect(service.revokeLink('ajeno', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(links[0].revokedAt).toBeNull();
    });

    it('con nivel read, crear, listar y revocar responden 404', async () => {
      const { service, links, driveAccess } = buildFixture();
      links.push(linkRow({ id: 'a' }));
      withAccessLevel(driveAccess, 'read');

      await expect(service.createLink('file-1', { expiresInDays: 1 }, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.listLinks('file-1', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.revokeLink('a', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(links).toHaveLength(1);
      expect(links[0].revokedAt).toBeNull();
    });
  });

  describe('Escenario 8: archivo en papelera', () => {
    it('crear sobre un archivo en papelera responde 404 y no inserta', async () => {
      const { service, files, linkRepo } = buildFixture();
      files[0] = { ...files[0], isDeleted: true } as FileRecord;

      await expect(service.createLink('file-1', { expiresInDays: 1 }, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(linkRepo.save).not.toHaveBeenCalled();
    });

    it('crear sobre un archivo en una carpeta en papelera responde 404', async () => {
      const { service, folders } = buildFixture();
      folders[0] = { ...folders[0], isDeleted: true } as Folder;

      await expect(service.createLink('file-1', { expiresInDays: 1 }, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('si el archivo pasa a papelera entre la comprobación previa y el bloqueo, no inserta', async () => {
      const { service, files, hooks, linkRepo } = buildFixture();
      hooks.onLock = () => {
        files[0] = { ...files[0], isDeleted: true } as FileRecord;
      };

      await expect(service.createLink('file-1', { expiresInDays: 1 }, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(linkRepo.save).not.toHaveBeenCalled();
    });

    it('listar sobre un archivo en papelera responde 404', async () => {
      const { service, files } = buildFixture();
      files[0] = { ...files[0], isDeleted: true } as FileRecord;

      await expect(service.listLinks('file-1', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('revocar un enlace de un archivo en papelera sí funciona', async () => {
      const { service, files, links } = buildFixture();
      links.push(linkRow({ id: 'a' }));
      files[0] = { ...files[0], isDeleted: true } as FileRecord;

      await expect(service.revokeLink('a', ACTOR)).resolves.toBeUndefined();
      expect(links[0].revokedAt).toBeInstanceOf(Date);
    });
  });

  describe('Escenario 9: auditoría', () => {
    it('crear y revocar registran SHARE_LINK_CREATED y SHARE_LINK_REVOKED sin token ni contraseña', async () => {
      const { service, logEvent } = buildFixture();
      const created = await service.createLink('file-1', { expiresInDays: 7, password: PASSWORD }, ACTOR);
      await service.revokeLink(created.id, ACTOR);

      expect(logEvent).toHaveBeenNthCalledWith(1, {
        organizationId: ORG,
        actorId: USER,
        action: AuditAction.SHARE_LINK_CREATED,
        resourceType: AuditResource.SHARE_LINK,
        resourceId: created.id,
      });
      expect(logEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
        action: AuditAction.SHARE_LINK_REVOKED,
        resourceType: AuditResource.SHARE_LINK,
        resourceId: created.id,
      }));
      const audited = JSON.stringify(logEvent.mock.calls);
      expect(audited).not.toContain(created.token);
      expect(audited).not.toContain(PASSWORD);
    });

    it('un fallo de auditoría no impide crear el enlace', async () => {
      const { service, logEvent, links } = buildFixture();
      logEvent.mockRejectedValueOnce(new Error('base de auditoría caída'));

      const created = await service.createLink('file-1', { expiresInDays: 1 }, ACTOR);

      expect(created.token).toBeDefined();
      expect(links).toHaveLength(1);
    });
  });

  describe('shareLinkStatus', () => {
    const now = new Date('2026-11-06T12:00:00.000Z');

    it('vence exactamente en el instante de expiración', () => {
      expect(shareLinkStatus({ revokedAt: null, expiresAt: now }, now)).toBe('expired');
    });

    it('revocado gana sobre vencido', () => {
      expect(shareLinkStatus({ revokedAt: now, expiresAt: new Date(now.getTime() - DAY_MS) }, now)).toBe('revoked');
    });

    it('sin revocar y con vencimiento futuro está activo', () => {
      expect(shareLinkStatus({ revokedAt: null, expiresAt: new Date(now.getTime() + 1) }, now)).toBe('active');
    });
  });
});
