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
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  Res,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { FilesService } from './files.service';

/**
 * Rutas de Carpetas (/folders)
 * Cumple con los contratos acordados para navegación y explorador de archivos.
 */
@Controller('folders')
@UseGuards(AuthGuard('jwt'))
export class FoldersController {
  constructor(private readonly filesService: FilesService) {}

  @Get()
  listFolders(@Request() req: any, @Query('parentId') parentId?: string) {
    const orgId = req.user.organizationId;
    return this.filesService.listFolders(orgId, parentId);
  }

  @Post()
  createFolder(
    @Request() req: any,
    @Body() body: { name: string; parentId?: string; parentFolderId?: string },
  ) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId || req.user.id;
    return this.filesService.createFolder(
      orgId,
      userId,
      body.name,
      body.parentId || body.parentFolderId,
    );
  }

  @Get(':id/items')
  getFolderItems(@Request() req: any, @Param('id') folderId: string) {
    const orgId = req.user.organizationId;
    return this.filesService.getFolderItems(orgId, folderId);
  }
}

/**
 * Rutas de Archivos (/files)
 * Manejo de subida multipart, descarga por stream, consulta y eliminación lógica.
 */
@Controller('files')
@UseGuards(AuthGuard('jwt'))
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get()
  listFiles(@Request() req: any, @Query('folderId') folderId?: string) {
    const orgId = req.user.organizationId;
    return this.filesService.listFiles(orgId, folderId);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB máximo
    }),
  )
  async uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 100 * 1024 * 1024 }),
          // Tipos permitidos según ADR-003: PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT, ZIP
          new FileTypeValidator({
            fileType: '.(png|jpeg|jpg|pdf|txt|doc|docx|xlsx|pptx|zip)',
          }),
        ],
      }),
    )
    file: any,
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

    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
    });

    stream.pipe(res);
  }

  @Delete(':id')
  softDelete(@Request() req: any, @Param('id') fileId: string) {
    const orgId = req.user.organizationId;
    return this.filesService.softDelete(fileId, orgId);
  }

  // Compatibilidad hacia atrás si algún cliente aún llama a /files/folders
  @Get('folders')
  listFoldersLegacy(@Request() req: any, @Query('parentId') parentId?: string) {
    return this.filesService.listFolders(req.user.organizationId, parentId);
  }

  @Post('folders')
  createFolderLegacy(
    @Request() req: any,
    @Body() body: { name: string; parentId?: string; parentFolderId?: string },
  ) {
    const userId = req.user.userId || req.user.id;
    return this.filesService.createFolder(
      req.user.organizationId,
      userId,
      body.name,
      body.parentId || body.parentFolderId,
    );
  }
}