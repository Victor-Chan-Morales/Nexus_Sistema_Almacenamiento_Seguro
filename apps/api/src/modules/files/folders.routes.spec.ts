import { INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';
import { DeploymentModel } from '../iam/domain/enums';
import { DriveAccessService } from './drive-access.service';
import { FoldersController } from './files.controller';
import { FilesService } from './files.service';
import { Destination } from './entities/destination.entity';
import { Folder } from './entities/folder.entity';
import { TenantEncryptionKey } from './entities/tenant-encryption-key.entity';
import { TenantQuota } from './entities/tenant-quota.entity';
import { FolderPlacementService } from './placement/folder-placement.service';

/**
 * SPEC-803 escenarios 5 a 8 y 10, por HTTP: `POST /folders` con el DTO y las pipes de producción.
 * El servicio de archivos y el placement son los reales; se simulan solo la base de datos (un manager que aplica
 * el `where` como SQL), el modelo de la organización y la resolución del Drive del solicitante.
 */

const ORG = 'org-1';
const USER = 'user-1';
const DEFAULT_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTED_ID = '22222222-2222-4222-8222-222222222222';
const DISCONNECTED_ID = '33333333-3333-4333-8333-333333333333';
const FOREIGN_ID = '44444444-4444-4444-8444-444444444444';
const ROOT_ID = '55555555-5555-4555-8555-555555555555';
const SUB_ID = '66666666-6666-4666-8666-666666666666';

const DESTINATIONS: Array<Record<string, unknown>> = [
  { id: DEFAULT_ID, organizationId: ORG, isEnabled: true, isDefault: true, connectionStatus: 'Sin comprobar', location: 'cloud' },
  { id: CONNECTED_ID, organizationId: ORG, isEnabled: true, isDefault: false, connectionStatus: 'Conectado', location: 'on_premises' },
  { id: DISCONNECTED_ID, organizationId: ORG, isEnabled: true, isDefault: false, connectionStatus: 'Sin conexión', location: 'on_premises' },
  { id: FOREIGN_ID, organizationId: 'org-2', isEnabled: true, isDefault: false, connectionStatus: 'Conectado', location: 'on_premises' },
];

const FOLDERS: Record<string, Record<string, unknown>> = {
  [ROOT_ID]: { id: ROOT_ID, parentId: null, destinationId: DEFAULT_ID, driveId: 'drive-1' },
  [SUB_ID]: { id: SUB_ID, parentId: ROOT_ID, destinationId: DEFAULT_ID, driveId: 'drive-1' },
};

/** Busca un destino como lo haría SQL: la fila solo aparece si cumple todas las condiciones del where. */
const matchDestination = (options: { where: Record<string, unknown> }) =>
  DESTINATIONS.find((row) => Object.entries(options.where).every(([key, value]) => row[key] === value)) ?? null;

describe('Rutas de carpetas (SPEC-803) por HTTP', () => {
  let app: INestApplication;
  let currentModel: DeploymentModel | null;
  let createFolderSpy: jest.SpyInstance;
  let folderRepo: { create: jest.Mock; save: jest.Mock };

  beforeAll(async () => {
    const modelSource = { findDeploymentModel: jest.fn(async () => currentModel) };
    folderRepo = {
      create: jest.fn((data: object) => ({ ...data })),
      save: jest.fn(async (data: object) => ({ id: 'carpeta-nueva', ...data })),
    };
    const repos = new Map<unknown, unknown>([
      [Destination, { findOne: jest.fn(async (options: { where: Record<string, unknown> }) => matchDestination(options)) }],
      [Folder, folderRepo],
      [TenantEncryptionKey, { findOne: jest.fn().mockResolvedValue({ id: 'key-1' }) }],
      [TenantQuota, { findOneBy: jest.fn().mockResolvedValue({ organizationId: ORG }) }],
    ]);
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(async (_entity: unknown, options: { where: Record<string, unknown> }) => matchDestination(options)),
      getRepository: jest.fn((entity: unknown) => repos.get(entity)),
    };
    const dataSource = { transaction: jest.fn(async (callback: (m: unknown) => Promise<unknown>) => callback(manager)) };

    const driveAccess = new DriveAccessService(dataSource as never);
    const placement = new FolderPlacementService(dataSource as never, modelSource as never);
    const files = new FilesService(
      {} as never, {} as never, {} as never,
      dataSource as never, {} as never, {} as never, {} as never, driveAccess,
      undefined, placement,
    );
    jest.spyOn(files as never as { ensureUserDrive: () => unknown }, 'ensureUserDrive').mockResolvedValue({
      id: 'drive-1', name: 'Mi espacio', rootFolderId: ROOT_ID,
    } as never);
    jest.spyOn(driveAccess, 'requireFolder').mockImplementation(async (_actor, folderId) => ({
      folder: FOLDERS[folderId] as never,
      access: { drive: { id: 'drive-1' } as never, level: 'owner' },
    }));
    createFolderSpy = jest.spyOn(files, 'createFolder');

    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, FoldersController) ?? [];
    const moduleRef = await Test.createTestingModule({
      controllers: [FoldersController],
      providers: [{ provide: FilesService, useValue: files }],
    })
      .overrideGuard(guards[0] as never)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
          context.switchToHttp().getRequest().user = { userId: USER, organizationId: ORG };
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
    currentModel = DeploymentModel.CLOUD;
  });

  it('el cuerpo que envía la web (name y parentFolderId) crea la carpeta en el predeterminado', async () => {
    const response = await request(app.getHttpServer())
      .post('/folders')
      .send({ name: 'Informes', parentFolderId: ROOT_ID })
      .expect(201);

    expect(response.body).toMatchObject({ name: 'Informes', destinationId: DEFAULT_ID, destinationLocation: 'cloud' });
  });

  it('un campo no declarado responde 400 sin llegar al servicio', async () => {
    const response = await request(app.getHttpServer())
      .post('/folders')
      .send({ name: 'Informes', organizationId: 'org-2' })
      .expect(400);

    expect(JSON.stringify(response.body)).not.toContain('org-2');
    expect(createFolderSpy).not.toHaveBeenCalled();
  });

  it('un destinationId que no es UUID responde 400 sin llegar al servicio', async () => {
    await request(app.getHttpServer())
      .post('/folders')
      .send({ name: 'Informes', parentFolderId: ROOT_ID, destinationId: 'no-es-uuid' })
      .expect(400);

    expect(createFolderSpy).not.toHaveBeenCalled();
  });

  describe('escenario 5: modelo cloud u on_premises', () => {
    it.each([DeploymentModel.CLOUD, DeploymentModel.ON_PREMISES])(
      'modelo %s: destinationId en una carpeta principal responde 422 DESTINATION_SELECTION_NOT_ALLOWED',
      async (model) => {
        currentModel = model;

        const response = await request(app.getHttpServer())
          .post('/folders')
          .send({ name: 'Nueva', parentFolderId: ROOT_ID, destinationId: CONNECTED_ID })
          .expect(422);

        expect(response.body).toMatchObject({ code: 'DESTINATION_SELECTION_NOT_ALLOWED' });
        expect(folderRepo.save).not.toHaveBeenCalled();
      },
    );
  });

  describe('escenarios 6, 7 y 10: modelo hybrid', () => {
    beforeEach(() => {
      currentModel = DeploymentModel.HYBRID;
    });

    it('una carpeta principal con un destino conectado usa ese destino', async () => {
      const response = await request(app.getHttpServer())
        .post('/folders')
        .send({ name: 'Nueva', parentFolderId: ROOT_ID, destinationId: CONNECTED_ID })
        .expect(201);

      expect(response.body).toMatchObject({ destinationId: CONNECTED_ID, destinationLocation: 'on_premises' });
      expect(folderRepo.create).toHaveBeenCalledWith(expect.objectContaining({ destinationId: CONNECTED_ID }));
    });

    it('una carpeta principal sin destinationId usa el predeterminado', async () => {
      const response = await request(app.getHttpServer())
        .post('/folders')
        .send({ name: 'Nueva', parentFolderId: ROOT_ID })
        .expect(201);

      expect(response.body).toMatchObject({ destinationId: DEFAULT_ID, destinationLocation: 'cloud' });
    });

    it.each([DISCONNECTED_ID, FOREIGN_ID])(
      'un destino no disponible (%s) responde 422 DESTINATION_NOT_AVAILABLE y no guarda la carpeta',
      async (destinationId) => {
        const response = await request(app.getHttpServer())
          .post('/folders')
          .send({ name: 'Nueva', parentFolderId: ROOT_ID, destinationId })
          .expect(422);

        expect(response.body).toMatchObject({ code: 'DESTINATION_NOT_AVAILABLE' });
        expect(folderRepo.save).not.toHaveBeenCalled();
      },
    );
  });

  describe('escenario 8: subcarpetas', () => {
    it('una subcarpeta sin destinationId hereda el destino de su padre', async () => {
      const response = await request(app.getHttpServer())
        .post('/folders')
        .send({ name: 'Nueva', parentFolderId: SUB_ID })
        .expect(201);

      expect(response.body).toMatchObject({ destinationId: DEFAULT_ID, destinationLocation: 'cloud' });
    });

    it('una subcarpeta con destinationId responde 422 DESTINATION_SELECTION_NOT_ALLOWED, también en modelo hybrid', async () => {
      currentModel = DeploymentModel.HYBRID;

      const response = await request(app.getHttpServer())
        .post('/folders')
        .send({ name: 'Nueva', parentFolderId: SUB_ID, destinationId: CONNECTED_ID })
        .expect(422);

      expect(response.body).toMatchObject({ code: 'DESTINATION_SELECTION_NOT_ALLOWED' });
      expect(folderRepo.save).not.toHaveBeenCalled();
    });
  });
});
