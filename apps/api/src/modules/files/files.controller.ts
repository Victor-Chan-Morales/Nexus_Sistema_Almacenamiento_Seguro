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
 * Contrato oficial de carpetas según CONTRACTS.md
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
    const folders = await this.filesService.listFolders(orgId, parentId || parentFolderId);
    return {
      items: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentFolderId: f.parentId,
        driveId: null,
      })),
    };
  }

  @Post()
  async createFolder(
    @Request() req: any,
    @Body() body: { name: string; parentId?: string; parentFolderId?: string },
  ) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId || req.user.id;
    const folder = await this.filesService.createFolder(
      orgId,
      userId,
      body.name,
      body.parentFolderId || body.parentId,
    );
    return {
      id: folder.id,
      name: folder.name,
      parentFolderId: folder.parentId,
      driveId: null,
      createdAt: folder.createdAt,
    };
  }

  @Get(':id/items')
  async getFolderItems(@Request() req: any, @Param('id') folderId: string) {
    const orgId = req.user.organizationId;
    const { folders, files } = await this.filesService.getFolderItems(orgId, folderId);
    return {
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentFolderId: f.parentId,
        driveId: null,
        createdAt: f.createdAt,
      })),
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      })),
    };
  }
}

/**
 * FilesController (/files)
 * Contrato oficial de archivos según CONTRACTS.md
 */
@Controller('files')
@UseGuards(AuthGuard('jwt'))
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get()
  async listFiles(@Request() req: any, @Query('folderId') folderId?: string) {
    const orgId = req.user.organizationId;
    const files = await this.filesService.listFiles(orgId, folderId);
    return files.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    }));
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB máximo
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

    // Sanitización de nombre de archivo contra path traversal
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