/// <reference types="jest" />

import { NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { PassThrough, Readable } from 'stream';
import { FilesService } from './files.service';
import { DriveAccessService } from './drive-access.service';
import { FilesController } from './files.controller';
import { FileVersionsService } from './file-versions.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditEventInput, AuditResource } from '../audit/audit.types';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { FileRecord } from './entities/file-record.entity';

describe('SPEC-405: Files Audit Hooks', () => {
  let filesService: FilesService;
  let fileVersions: FileVersionsService;
  let driveAccess: DriveAccessService;
  let filesController: FilesController;
  let mockAuditService: { logEvent: jest.Mock };
  let mockFileRepo: { save: jest.Mock };
  let mockDataSource: { transaction: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockAuditService = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };

    mockFileRepo = {
      save: jest.fn(),
    };

    mockDataSource = {
      transaction: jest.fn(),
    };

    // Drive personal del solicitante para SPEC-221; la lectura del Drive devuelve un Drive propio.
    driveAccess = new DriveAccessService({
      getRepository: () => ({
        findOne: jest.fn().mockResolvedValue({ id: 'drive-1', name: 'Drive', rootFolderId: 'root-1' }),
      }),
    } as never);
    filesService = new FilesService(
      mockFileRepo as never,
      {} as never,
      {} as never,
      mockDataSource as never,
      { delete: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      driveAccess,
      mockAuditService as unknown as AuditService,
      {} as never,
    );

    fileVersions = new FileVersionsService(
      { findOne: jest.fn() } as never,
      filesService,
      {} as never,
      {} as never,
      driveAccess,
      mockAuditService as unknown as AuditService,
    );

    filesController = new FilesController(
      filesService,
      fileVersions,
      {} as never,
      mockAuditService as unknown as AuditService,
    );
  });

  describe('FILE_UPLOAD en FilesService.uploadMultipartFile', () => {
    it('registra FILE_UPLOAD tras confirmar la transacción de subida', async () => {
      const orgId = 'org-up-1';
      const userId = 'usr-up-1';
      const folderId = '33333333-3333-4333-8333-333333333333';
      const fileId = 'file-new-1';

      jest.spyOn(filesService, 'getOrCreateUserDrive').mockResolvedValue({
        id: 'drive-1',
        name: 'Drive',
        rootFolderId: 'root-1',
      });
      jest.spyOn(driveAccess, 'requireFolder').mockResolvedValue({
        folder: { id: folderId } as never,
        access: { drive: { id: 'drive-1' } as never, level: 'owner' },
      });
      jest.spyOn(filesService as any, 'reserveUpload').mockResolvedValue({
        reservationId: 'res-1',
        uploadId: 'up-1',
      });
      jest.spyOn(filesService as any, 'hasExpectedContent').mockReturnValue(true);

      mockDataSource.transaction.mockResolvedValue({
        id: fileId,
        name: 'documento.txt',
        mimeType: 'text/plain',
        sizeBytes: 15,
        versionId: 'v-1',
        uploadedAt: new Date(),
      });

      const result = await filesService.uploadMultipartFile({
        organizationId: orgId,
        ownerId: userId,
        folderId,
        file: {
          originalname: 'documento.txt',
          mimetype: 'text/plain',
          buffer: Buffer.from('contenido prueba'),
        },
      });

      expect(result.id).toBe(fileId);
      expect(mockAuditService.logEvent).toHaveBeenCalledTimes(1);
      expect(mockAuditService.logEvent).toHaveBeenCalledWith({
        organizationId: orgId,
        actorId: userId,
        action: AuditAction.FILE_UPLOAD,
        resourceType: AuditResource.FILE,
        resourceId: fileId,
      });
    });

    it('no registra FILE_UPLOAD si la transacción de subida falla (Escenario 2)', async () => {
      jest.spyOn(filesService, 'getOrCreateUserDrive').mockResolvedValue({
        id: 'drive-1',
        name: 'Drive',
        rootFolderId: 'root-1',
      });
      jest.spyOn(driveAccess, 'requireFolder').mockResolvedValue({
        folder: { id: '11111111-1111-4111-8111-111111111111' } as never,
        access: { drive: { id: 'drive-1' } as never, level: 'owner' },
      });
      jest.spyOn(filesService as any, 'reserveUpload').mockResolvedValue({
        reservationId: 'res-1',
        uploadId: 'up-1',
      });
      jest.spyOn(filesService as any, 'hasExpectedContent').mockReturnValue(true);
      jest.spyOn(filesService as any, 'finishFailedUpload').mockResolvedValue(undefined);

      mockDataSource.transaction.mockRejectedValue(new Error('Error de cuota en BD'));

      await expect(
        filesService.uploadMultipartFile({
          organizationId: 'org-1',
          ownerId: 'usr-1',
          folderId: '11111111-1111-4111-8111-111111111111',
          file: {
            originalname: 'documento.txt',
            mimetype: 'text/plain',
            buffer: Buffer.from('contenido'),
          },
        }),
      ).rejects.toThrow();

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('devuelve la subida aunque logEvent falle (Escenario 3)', async () => {
      jest.spyOn(filesService, 'getOrCreateUserDrive').mockResolvedValue({
        id: 'drive-1',
        name: 'Drive',
        rootFolderId: 'root-1',
      });
      jest.spyOn(driveAccess, 'requireFolder').mockResolvedValue({
        folder: { id: '11111111-1111-4111-8111-111111111111' } as never,
        access: { drive: { id: 'drive-1' } as never, level: 'owner' },
      });
      jest.spyOn(filesService as any, 'reserveUpload').mockResolvedValue({
        reservationId: 'res-1',
        uploadId: 'up-1',
      });
      jest.spyOn(filesService as any, 'hasExpectedContent').mockReturnValue(true);

      mockDataSource.transaction.mockResolvedValue({
        id: 'file-ok-1',
        name: 'documento.txt',
        mimeType: 'text/plain',
        sizeBytes: 9,
        versionId: 'v-1',
        uploadedAt: new Date(),
      });
      mockAuditService.logEvent.mockRejectedValueOnce(new Error('Audit DB down'));

      const result = await filesService.uploadMultipartFile({
        organizationId: 'org-1',
        ownerId: 'usr-1',
        folderId: '11111111-1111-4111-8111-111111111111',
        file: {
          originalname: 'documento.txt',
          mimetype: 'text/plain',
          buffer: Buffer.from('contenido'),
        },
      });

      expect(result.id).toBe('file-ok-1');
      expect(mockAuditService.logEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('FILE_DELETE en FilesService.softDelete', () => {
    it('registra FILE_DELETE tras marcar isDeleted exitosamente', async () => {
      const orgId = 'org-test-1';
      const userId = 'usr-test-1';
      const fileId = 'file-abc-123';

      jest.spyOn(driveAccess, 'locateFile').mockResolvedValue({
        file: { id: fileId, organizationId: orgId, isDeleted: false } as FileRecord,
        folder: { isDeleted: false } as never,
        access: { drive: { id: 'drive-1' } as never, level: 'owner' },
      });
      mockDataSource.transaction.mockImplementation((work) =>
        work({ query: jest.fn().mockResolvedValue([]), getRepository: () => mockFileRepo }));
      mockFileRepo.save.mockImplementation(async (entity: FileRecord) => ({ ...entity, id: fileId }));

      const result = await filesService.softDelete(fileId, orgId, userId);

      expect(result.isDeleted).toBe(true);
      expect(mockAuditService.logEvent).toHaveBeenCalledTimes(1);
      expect(mockAuditService.logEvent).toHaveBeenCalledWith({
        organizationId: orgId,
        actorId: userId,
        action: AuditAction.FILE_DELETE,
        resourceType: AuditResource.FILE,
        resourceId: fileId,
      });
    });

    it('no registra auditoría si el archivo no existe (fallo previo)', async () => {
      jest.spyOn(driveAccess, 'locateFile').mockResolvedValue(null);
      mockDataSource.transaction.mockImplementation((work) =>
        work({ query: jest.fn().mockResolvedValue([]), getRepository: () => mockFileRepo }));

      await expect(filesService.softDelete('file-inexistente', 'org-1', 'usr-1'))
        .rejects
        .toThrow(NotFoundException);

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('no bloquea la operación si logEvent falla o lanza excepción', async () => {
      mockAuditService.logEvent.mockRejectedValueOnce(new Error('Audit DB down'));

      jest.spyOn(driveAccess, 'locateFile').mockResolvedValue({
        file: { id: 'file-1', organizationId: 'org-1', isDeleted: false } as FileRecord,
        folder: { isDeleted: false } as never,
        access: { drive: { id: 'drive-1' } as never, level: 'owner' },
      });
      mockDataSource.transaction.mockImplementation((work) =>
        work({ query: jest.fn().mockResolvedValue([]), getRepository: () => mockFileRepo }));
      mockFileRepo.save.mockImplementation(async (entity: FileRecord) => entity);

      const result = await filesService.softDelete('file-1', 'org-1', 'usr-1');

      expect(result.isDeleted).toBe(true);
      expect(mockAuditService.logEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('FILE_DOWNLOAD en FilesController.downloadFile', () => {
    it('registra FILE_DOWNLOAD tras obtener el stream del archivo', async () => {
      const req = { user: { organizationId: 'org-dl-1', userId: 'usr-dl-1' } };

      const res = new PassThrough() as unknown as Response;
      (res as any).set = jest.fn();
      (res as any).headersSent = false;
      (res as any).status = jest.fn().mockReturnValue(res);
      (res as any).json = jest.fn();

      jest.spyOn(filesService, 'downloadFileStream').mockResolvedValue({
        stream: Readable.from(['contenido-binario']),
        mimeType: 'text/plain',
        name: 'reporte.txt',
      });

      await filesController.downloadFile(req, 'file-999', res);

      expect(mockAuditService.logEvent).toHaveBeenCalledTimes(1);
      expect(mockAuditService.logEvent).toHaveBeenCalledWith({
        organizationId: 'org-dl-1',
        actorId: 'usr-dl-1',
        action: AuditAction.FILE_DOWNLOAD,
        resourceType: AuditResource.FILE,
        resourceId: 'file-999',
      });
    });

    it('no registra FILE_DOWNLOAD si el archivo no existe (Escenario 2)', async () => {
      const req = { user: { organizationId: 'org-dl-2', userId: 'usr-dl-2' } };
      const res = new PassThrough() as unknown as Response;

      jest.spyOn(filesService, 'downloadFileStream').mockRejectedValue(new NotFoundException('no existe'));

      await expect(filesController.downloadFile(req, 'file-404', res)).rejects.toThrow(NotFoundException);

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('entrega el archivo aunque logEvent falle (Escenario 3)', async () => {
      const req = { user: { organizationId: 'org-dl-3', userId: 'usr-dl-3' } };

      const res = new PassThrough() as unknown as Response;
      (res as any).set = jest.fn();
      (res as any).headersSent = false;
      (res as any).status = jest.fn().mockReturnValue(res);
      (res as any).json = jest.fn();

      mockAuditService.logEvent.mockRejectedValueOnce(new Error('Audit DB down'));
      jest.spyOn(filesService, 'downloadFileStream').mockResolvedValue({
        stream: Readable.from(['contenido-binario']),
        mimeType: 'text/plain',
        name: 'reporte.txt',
      });

      await filesController.downloadFile(req, 'file-888', res);

      expect(mockAuditService.logEvent).toHaveBeenCalledTimes(1);
      expect((res as any).set).toHaveBeenCalled();
    });
  });

  describe('FILE_DOWNLOAD en FilesController.downloadVersion (SPEC-210)', () => {
    const user = { organizationId: 'org-vd-1', userId: 'usr-vd-1' } as AuthUser;

    const buildResponse = () =>
      Object.assign(new PassThrough(), {
        set: jest.fn(),
        status: jest.fn(),
        json: jest.fn(),
        headersSent: false,
      });

    it('registra FILE_DOWNLOAD con el fileId tras resolver la versión', async () => {
      const res = buildResponse();
      jest.spyOn(fileVersions, 'downloadVersion').mockResolvedValue({
        stream: Readable.from(['contenido-v1']),
        mimeType: 'application/pdf',
        name: 'informe.pdf',
      });

      await filesController.downloadVersion(user, 'file-9', 'v-1', res as unknown as Response);

      expect(mockAuditService.logEvent).toHaveBeenCalledTimes(1);
      expect(mockAuditService.logEvent).toHaveBeenCalledWith({
        organizationId: 'org-vd-1',
        actorId: 'usr-vd-1',
        action: AuditAction.FILE_DOWNLOAD,
        resourceType: AuditResource.FILE,
        resourceId: 'file-9',
      });
    });

    it('usa las mismas cabeceras que la descarga actual, con el nombre saneado', async () => {
      const res = buildResponse();
      jest.spyOn(fileVersions, 'downloadVersion').mockResolvedValue({
        stream: Readable.from(['contenido']),
        mimeType: 'application/pdf',
        name: 'informe: "final"/v2.pdf',
      });

      await filesController.downloadVersion(user, 'file-9', 'v-2', res as unknown as Response);

      expect(res.set).toHaveBeenCalledWith({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="informe_ _final__v2.pdf"; filename*=UTF-8''informe_%20_final__v2.pdf`,
        'Access-Control-Expose-Headers': 'Content-Disposition',
      });
    });

    it('no registra FILE_DOWNLOAD si la versión no es accesible (404)', async () => {
      const res = new PassThrough() as unknown as Response;
      jest.spyOn(fileVersions, 'downloadVersion').mockRejectedValue(new NotFoundException('no existe'));

      await expect(filesController.downloadVersion(user, 'file-9', 'v-otra', res)).rejects.toThrow(NotFoundException);

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('FILE_VERSION_RESTORED en FileVersionsService.restoreVersion (SPEC-210)', () => {
    it('FILE_UPLOAD y FILE_VERSION_RESTORED comparten correlationId', async () => {
      const orgId = 'org-rs-1';
      const userId = 'usr-rs-1';
      const fileId = 'file-rs-1';
      const folderId = '44444444-4444-4444-8444-444444444444';

      // Carga real de FilesService; se simulan solo sus dependencias de reserva y transacción.
      jest.spyOn(filesService, 'getOrCreateUserDrive').mockResolvedValue({
        id: 'drive-1',
        name: 'Drive',
        rootFolderId: 'root-1',
      });
      jest.spyOn(driveAccess, 'requireFolder').mockResolvedValue({
        folder: { id: folderId } as never,
        access: { drive: { id: 'drive-1' } as never, level: 'owner' },
      });
      const uploadInternals = filesService as unknown as {
        reserveUpload(params: unknown): Promise<{ reservationId: string; uploadId: string }>;
        hasExpectedContent(extension: string, bytes: Buffer): boolean;
      };
      jest.spyOn(uploadInternals, 'reserveUpload').mockResolvedValue({ reservationId: 'res-1', uploadId: 'up-1' });
      jest.spyOn(uploadInternals, 'hasExpectedContent').mockReturnValue(true);
      mockDataSource.transaction.mockResolvedValue({
        id: fileId,
        name: 'informe.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4,
        versionId: 'v-new',
        versionNumber: 4,
        uploadedAt: new Date(),
      });

      // Localización y lecturas de versión simuladas.
      jest.spyOn(driveAccess, 'locateFile').mockResolvedValue({
        file: { id: fileId, folderId, name: 'informe.pdf', mimeType: 'application/pdf', currentVersionId: 'v-cur', isDeleted: false } as never,
        folder: { id: folderId, isDeleted: false } as never,
        access: { drive: { id: 'drive-1' } as never, level: 'owner' },
      });
      const versionRepository = {
        findOne: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === 'v-old' ? { id: 'v-old', fileId, versionNumber: 1 } : { id: 'v-new', fileId, versionNumber: 4 }),
        ),
      };
      const restoringService = new FileVersionsService(
        versionRepository as never,
        filesService,
        {} as never,
        {} as never,
        driveAccess,
        mockAuditService as unknown as AuditService,
      );
      jest.spyOn(restoringService, 'readVersionBytes').mockResolvedValue(Buffer.from('hola'));

      const result = await restoringService.restoreVersion(fileId, 'v-old', { organizationId: orgId, userId });

      expect(result.versionNumber).toBe(4);
      const events: AuditEventInput[] = mockAuditService.logEvent.mock.calls.map(([event]) => event as AuditEventInput);
      expect(events.map((event) => event.action)).toEqual([AuditAction.FILE_UPLOAD, AuditAction.FILE_VERSION_RESTORED]);
      expect(events[0].correlationId).toEqual(expect.any(String));
      expect(events[1].correlationId).toBe(events[0].correlationId);
      expect(events[1]).toMatchObject({ organizationId: orgId, actorId: userId, resourceId: fileId });
    });
  });
});
