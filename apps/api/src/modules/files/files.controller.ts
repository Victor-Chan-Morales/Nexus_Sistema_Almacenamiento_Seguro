import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  Headers,
  Res,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { FilesService } from './files.service';

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
    return this.filesService.getFolderItems(orgId, folderId);
  }
}

/**
 * FilesController (/files)
 * Contrato canónico de archivos según CONTRACTS.md v0.3
 */
@Controller('files')
@UseGuards(AuthGuard('jwt'))
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get()
  async listFiles(@Request() req: any, @Query('folderId') folderId?: string) {
    const orgId = req.user.organizationId;
    return this.filesService.listFiles(orgId, folderId);
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
    const { stream, mimeType, name } = await this.filesService.downloadFileStream(
      fileId,
      orgId,
    );

    const safeFilename = name.replace(/[/\\?%*:|"<>]/g, '_');
    const rfc5987Filename = encodeURIComponent(safeFilename);

    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${rfc5987Filename}`,
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });

    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ statusCode: 500, message: 'Error en la transmisión del archivo' });
      }
    });

    stream.pipe(res);
  }

  @Delete(':id')
  async softDelete(@Request() req: any, @Param('id') fileId: string) {
    const orgId = req.user.organizationId;
    await this.filesService.softDelete(fileId, orgId);
    return { success: true, id: fileId };
  }
}