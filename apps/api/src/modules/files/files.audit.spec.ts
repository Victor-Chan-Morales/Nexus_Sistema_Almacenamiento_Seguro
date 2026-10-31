/// <reference types="jest" />

import { NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { PassThrough, Readable } from 'stream';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { FileRecord } from './entities/file-record.entity';

describe('SPEC-405: Files Audit Hooks', () => {
  let filesService: FilesService;
  let filesController: FilesController;
  let mockAuditService: { logEvent: jest.Mock };
  let mockFileRepo: { createQueryBuilder: jest.Mock; save: jest.Mock };
  let mockDataSource: { transaction: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockAuditService = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };

    mockFileRepo = {
      createQueryBuilder: jest.fn(),
      save: jest.fn(),
    };

    mockDataSource = {
      transaction: jest.fn(),
    };

    filesService = new FilesService(
      mockFileRepo as never,
      {} as never,
      {} as never,
      mockDataSource as never,
      { delete: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      mockAuditService as unknown as AuditService,
    );

    filesController = new FilesController(
      filesService,
      mockAuditService as unknown as AuditService,
    );
  });

  describe('FILE_UPLOAD en FilesService.uploadMultipartFile', () => {
    it('registra FILE_UPLOAD tras confirmar la transacción de subida', async () => {
      const orgId = 'org-up-1';
      const userId = 'usr-up-1';
      const folderId = 'folder-up-1';
      const fileId = 'file-new-1';

      jest.spyOn(filesService, 'getOrCreateUserDrive').mockResolvedValue({
        id: 'drive-1',
        name: 'Drive',
        rootFolderId: 'root-1',
      });
      jest.spyOn(filesService as any, 'requirePersonalFolder').mockResolvedValue({ id: folderId });
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
      jest.spyOn(filesService as any, 'requirePersonalFolder').mockResolvedValue({ id: 'folder-1' });
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
          folderId: 'folder-1',
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
      jest.spyOn(filesService as any, 'requirePersonalFolder').mockResolvedValue({ id: 'folder-1' });
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
        folderId: 'folder-1',
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

      jest.spyOn(filesService, 'getOrCreateUserDrive').mockResolvedValue({
        id: 'drive-1',
        name: 'Drive',
        rootFolderId: 'root-1',
      });

      const qbMock: any = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: fileId,
          organizationId: orgId,
          isDeleted: false,
        }),
      };
      mockFileRepo.createQueryBuilder.mockReturnValue(qbMock);
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
      jest.spyOn(filesService, 'getOrCreateUserDrive').mockResolvedValue({
        id: 'drive-1',
        name: 'Drive',
        rootFolderId: 'root-1',
      });

      const qbMock: any = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      mockFileRepo.createQueryBuilder.mockReturnValue(qbMock);

      await expect(filesService.softDelete('file-inexistente', 'org-1', 'usr-1'))
        .rejects
        .toThrow(NotFoundException);

      expect(mockAuditService.logEvent).not.toHaveBeenCalled();
    });

    it('no bloquea la operación si logEvent falla o lanza excepción', async () => {
      mockAuditService.logEvent.mockRejectedValueOnce(new Error('Audit DB down'));

      jest.spyOn(filesService, 'getOrCreateUserDrive').mockResolvedValue({
        id: 'drive-1',
        name: 'Drive',
        rootFolderId: 'root-1',
      });

      const qbMock: any = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'file-1', organizationId: 'org-1' }),
      };
      mockFileRepo.createQueryBuilder.mockReturnValue(qbMock);
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
});
