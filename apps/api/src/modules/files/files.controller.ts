import {
  Controller, Get, Post, Delete, Param, Body,
  UseGuards, Request, Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesService } from './files.service';

/**
 * FilesController
 *
 * GET  /api/files?orgId=&folderId=  → Lista archivos
 * GET  /api/files/:id/download      → URL de descarga prefirmada
 * POST /api/files/folders           → Crear carpeta
 * DELETE /api/files/:id             → Mover a papelera
 */
@Controller('files')
@UseGuards(AuthGuard('jwt'))
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get()
  listFiles(
    @Request() req,
    @Query('folderId') folderId?: string,
  ) {
    const orgId = req.user.organizationId;
    return this.filesService.listFiles(orgId, folderId);
  }

  @Get('folders')
  listFolders(
    @Request() req,
    @Query('parentId') parentId?: string,
  ) {
    const orgId = req.user.organizationId;
    return this.filesService.listFolders(orgId, parentId);
  }

  @Post('folders')
  createFolder(
    @Request() req,
    @Body() body: { name: string; parentId?: string; parentFolderId?: string },
  ) {
    const orgId = req.user.organizationId;
    return this.filesService.createFolder(
      orgId,
      req.user.userId,
      body.name,
      body.parentId || body.parentFolderId,
    );
  }

  @Get(':id/download')
  getDownloadUrl(
    @Request() req,
    @Param('id') id: string,
  ) {
    const orgId = req.user.organizationId;
    return this.filesService.getDownloadUrl(id, orgId);
  }

  @Delete(':id')
  softDelete(
    @Request() req,
    @Param('id') id: string,
  ) {
    const orgId = req.user.organizationId;
    return this.filesService.softDelete(id, orgId);
  }
}
