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
  FileTypeValidator,
  Res
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';

@Controller('v1')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('drives')
  async createDrive(@Body('name') name: string) {
    const mockOrganizationId = '00000000-0000-0000-0000-000000000001';
    return this.filesService.createDrive(name, mockOrganizationId);
  }

  @Post('folders')
  async createFolder(
    @Body('driveId') driveId: string,
    @Body('name') name: string,
    @Body('parentFolderId') parentFolderId?: string
  ) {
    const mockOrganizationId = '00000000-0000-0000-0000-000000000001';
    return this.filesService.createFolder(name, driveId, mockOrganizationId, parentFolderId);
  }

  @Post('files/upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 100 * 1024 * 1024 } 
  }))
  async uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 100 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: '.(png|jpeg|jpg|pdf|txt|doc|docx)' }), 
        ],
      }),
    ) file: any,
    @Body('folderId') folderId: string,
    @Headers('Idempotency-Key') idempotencyKey: string,
    @Request() req: any
  ) {
    const mockOrganizationId = '00000000-0000-0000-0000-000000000001'; 
    return await this.filesService.uploadFile(file, file.buffer, folderId, mockOrganizationId, idempotencyKey);
  }

  @Get('files/:id/download')
  async downloadFile(@Param('id') fileId: string, @Res() res: any) {
     const mockOrganizationId = '00000000-0000-0000-0000-000000000001';
     
     const { stream, mimeType, name } = await this.filesService.downloadFile(fileId, mockOrganizationId);
     
     res.set({
       'Content-Type': mimeType,
       'Content-Disposition': `attachment; filename="${name}"`,
     });
     
     stream.pipe(res);
  }
}