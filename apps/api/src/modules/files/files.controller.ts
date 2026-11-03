import {
  Controller,
  Get,
  Post,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  Headers,
  Res,
  Optional,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { pipeline } from 'stream/promises';
import { FilesService } from './files.service';
import { PurgeFileResponseDto, RestoreFileResponseDto, RestoreFolderResponseDto, TrashResponseDto } from './dto/trash.dto';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';

/**
 * FoldersController (/folders)
 * Contrato canónico de navegación de carpetas según CONTRACTS.md v0.3
 */
@Controller('folders')
@UseGuards(AuthGuard('jwt'))
export class FoldersController {
  constructor(private readonly filesService: FilesService) {}

  @Get()
  async listFolders(
    @Request() req: any,
    @Query('parentId') parentId?: string,
    @Query('parentFolderId') parentFolderId?: string,
  ) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId || req.user.id;
    return this.filesService.listFolders(orgId, userId, parentId || parentFolderId);
  }

  @Post()
  async createFolder(
    @Request() req: any,
    @Body() body: { name: string; parentId?: string; parentFolderId?: string },
  ) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId || req.user.id;
    return this.filesService.createFolder(
      orgId,
      userId,
      body.name,
      body.parentFolderId || body.parentId,
    );
  }

  @Get(':id/items')
  async getFolderItems(@Request() req: any, @Param('id') folderId: string) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId || req.user.id;
    return this.filesService.getFolderItems(orgId, userId, folderId);
  }

  /** Mueve una carpeta y sus descendientes a la papelera como unidad. */
  @Delete(':id')
  async softDeleteFolder(@CurrentUser() user: AuthUser, @Param('id') folderId: string) {
    return this.filesService.softDeleteFolder(folderId, user.organizationId, user.userId);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restoreFolder(
    @CurrentUser() user: AuthUser,
    @Param('id') folderId: string,
  ): Promise<RestoreFolderResponseDto> {
    return this.filesService.restoreFolder(folderId, user.organizationId, user.userId);
  }

  @Delete(':id/purge')
  async purgeFolder(
    @CurrentUser() user: AuthUser,
    @Param('id') folderId: string,
  ): Promise<PurgeFileResponseDto> {
    return this.filesService.purgeFolder(folderId, user.organizationId, user.userId);
  }
}

/**
 * FilesController (/files)
 * Contrato canónico de archivos según CONTRACTS.md v0.3
 */
@Controller('files')
@UseGuards(AuthGuard('jwt'))
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  /**
   * SPEC-202: Listado de archivos en papelera para el Drive personal del solicitante.
   * Se ubica antes de rutas dinámicas con :id para evitar colisiones de enrutamiento.
   */
  @Get('trash')
  async getTrash(@CurrentUser() user: AuthUser): Promise<TrashResponseDto> {
    return this.filesService.listTrash(user.organizationId, user.userId);
  }

  /** SPEC-203: `POST` responde 201 por defecto; el contrato exige 200. */
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @CurrentUser() user: AuthUser,
    @Param('id') fileId: string,
  ): Promise<RestoreFileResponseDto> {
    return this.filesService.restoreFile(fileId, user.organizationId, user.userId);
  }

  /** SPEC-204: purga definitiva. `DELETE` responde 200 por defecto. */
  @Delete(':id/purge')
  async purge(
    @CurrentUser() user: AuthUser,
    @Param('id') fileId: string,
  ): Promise<PurgeFileResponseDto> {
    return this.filesService.purgeFile(fileId, user.organizationId, user.userId);
  }

  @Get()
  async listFiles(@Request() req: any, @Query('folderId') folderId?: string) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId || req.user.id;
    return this.filesService.listFiles(orgId, userId, folderId);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 100000000 }, // 100,000,000 bytes exactos
    }),
  )
  async uploadFile(
    @UploadedFile() file: any,
    @Body('folderId') folderId: string,
    @Headers('Idempotency-Key') idempotencyKey: string,
    @Request() req: any,
  ) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId || req.user.id;

    return this.filesService.uploadMultipartFile({
      organizationId: orgId,
      ownerId: userId,
      folderId,
      file,
      idempotencyKey,
    });
  }

  @Get(':id/download')
  async downloadFile(
    @Request() req: any,
    @Param('id') fileId: string,
    @Res() res: Response,
  ) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId || req.user.id;
    const { stream, mimeType, name } = await this.filesService.downloadFileStream(
      fileId,
      orgId,
      userId,
    );

    // Enganche SPEC-405: FILE_DOWNLOAD tras resolver el archivo exitosamente
    void this.auditService?.logEvent({
      organizationId: orgId,
      actorId: userId,
      action: AuditAction.FILE_DOWNLOAD,
      resourceType: AuditResource.FILE,
      resourceId: fileId,
    }).catch(() => {});

    const safeFilename = name.replace(/[/\\?%*:|"<>]/g, '_');
    const rfc5987Filename = encodeURIComponent(safeFilename);

    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${rfc5987Filename}`,
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });

    try {
      await pipeline(stream, res);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ statusCode: 500, message: 'Error en la transmisión del archivo' });
      }
    }
  }

  @Delete(':id')
  async softDelete(@Request() req: any, @Param('id') fileId: string) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId || req.user.id;
    await this.filesService.softDelete(fileId, orgId, userId);
    return { success: true, id: fileId };
  }
}
