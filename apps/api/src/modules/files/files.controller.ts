import { Controller, Post, UseInterceptors, UploadedFile, Headers, Body, Request } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';

@Controller('v1/files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file')) // Intercepta el archivo del form-data
  async uploadFile(
    @UploadedFile() file: any,
    @Body('folderId') folderId: string,
    @Headers('Idempotency-Key') idempotencyKey: string,
    @Request() req: any
  ) {
    // Para el MVP 30%: Simulamos el tenant sacado de la sesión (luego IAM lo inyectará real)
    const mockOrganizationId = '00000000-0000-0000-0000-000000000001'; 
    
    // Llamamos al servicio para que haga el trabajo
    const result = await this.filesService.uploadFile(file, file.buffer, mockOrganizationId);

    return result;
  }
}