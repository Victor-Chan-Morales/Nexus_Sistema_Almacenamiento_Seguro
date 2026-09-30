import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFile,
  Headers,
  Body,
  Request,
  ParseFilePipe,
  MaxFileSizeValidator,
  Res
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';

@Controller('v1')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  // Requerimiento Urgente: 1. Crear Drive inicial
  @Post('drives')
  async createDrive(@Body('name') name: string) {
    const mockOrganizationId = '00000000-0000-0000-0000-000000000001';
    // TODO: Insertar en PostgreSQL files.drive
    return { message: 'Drive endpoint listo para BD' };
  }

  // Requerimiento Urgente: 2. Carpetas
  @Post('folders')
  async createFolder(
    @Body('driveId') driveId: string,
    @Body('name') name: string,
    @Body('parentFolderId') parentFolderId?: string
  ) {
    const mockOrganizationId = '00000000-0000-0000-0000-000000000001';
    // TODO: Insertar en PostgreSQL files.folder
    return { message: 'Folder endpoint listo para BD' };
  }

  // Requerimiento Urgente: 3, 5 y 6. Metadatos, Límite 100MB y Cuota
  @Post('files/upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 100 * 1024 * 1024 } // Límite estricto de 100 MB en la capa HTTP
  }))
  async uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 100 * 1024 * 1024 })],
      }),
    ) file: any,
    @Body('folderId') folderId: string,
    @Headers('Idempotency-Key') idempotencyKey: string,
    @Request() req: any
  ) {
    const mockOrganizationId = '00000000-0000-0000-0000-000000000001'; 
    // TODO: Validar files.tenant_quota en PostgreSQL antes de subir
    const result = await this.filesService.uploadFile(file, file.buffer, folderId, mockOrganizationId);
    return result;
  }

  // Requerimiento Urgente: 4. Descarga
  @Get('files/:id/download')
  async downloadFile(@Param('id') fileId: string, @Res() res: any) {
     const mockOrganizationId = '00000000-0000-0000-0000-000000000001';
     // TODO: Validar acceso en PostgreSQL y conectar stream desde MinIO
     return res.send({ message: 'Download endpoint listo para BD' });
  }
}