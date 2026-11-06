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
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { FilesService } from './files.service';
import { FileVersionsService, RestoredVersionDto } from './file-versions.service';
import { PurgeFileResponseDto, RestoreFileResponseDto, RestoreFolderResponseDto, TrashResponseDto } from './dto/trash.dto';
import { FileVersionsResponseDto } from './dto/versions.dto';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';

/** Nombre seguro para `Content-Disposition`: sustituye los caracteres reservados por `_`. */
function attachmentDisposition(name: string): string {
  const safeFilename = name.replace(/[/\\?%*:|"<>]/g, '_');
  const rfc5987Filename = encodeURIComponent(safeFilename);
  return `attachment; filename="${safeFilename}"; filename*=UTF-8''${rfc5987Filename}`;
}

/** Envía un archivo como descarga. Si la transmisión falla a medio camino, responde 500 solo si aún no hay cabeceras. */
async function sendAttachment(res: Response, stream: Readable, mimeType: string, name: string): Promise<void> {
  res.set({
    'Content-Type': mimeType,
    'Content-Disposition': attachmentDisposition(name),
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
    private readonly fileVersions: FileVersionsService,
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

  /** SPEC-206: historial de versiones (solo lectura) de un archivo propio y activo. */
  @Get(':id/versions')
  async listVersions(
    @CurrentUser() user: AuthUser,
    @Param('id') fileId: string,
  ): Promise<FileVersionsResponseDto> {
    return this.fileVersions.listVersions(fileId, user.organizationId, user.userId);
  }

  /** SPEC-210: bytes exactos de una versión propia y activa, con las mismas cabeceras que la descarga actual. */
  @Get(':id/versions/:versionId/download')
  async downloadVersion(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) fileId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, mimeType, name } = await this.fileVersions.downloadVersion(fileId, versionId, {
      organizationId: user.organizationId,
      userId: user.userId,
    });

    // Enganche SPEC-405: FILE_DOWNLOAD tras resolver la versión exitosamente
    void this.auditService?.logEvent({
      organizationId: user.organizationId,
      actorId: user.userId,
      action: AuditAction.FILE_DOWNLOAD,
      resourceType: AuditResource.FILE,
      resourceId: fileId,
    }).catch(() => {});

    await sendAttachment(res, stream, mimeType, name);
  }

  /** SPEC-210: crea una versión nueva con el contenido de la indicada. El `POST` responde 200. */
  @Post(':id/versions/:versionId/restore')
  @HttpCode(HttpStatus.OK)
  async restoreVersion(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) fileId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
  ): Promise<RestoredVersionDto> {
    return this.fileVersions.restoreVersion(fileId, versionId, {
      organizationId: user.organizationId,
      userId: user.userId,
    });
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

    await sendAttachment(res, stream, mimeType, name);
  }

  @Delete(':id')
  async softDelete(@Request() req: any, @Param('id') fileId: string) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId || req.user.id;
    await this.filesService.softDelete(fileId, orgId, userId);
    return { success: true, id: fileId };
  }
}
