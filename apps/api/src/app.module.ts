import { Module } from '@nestjs/common';
import { FilesModule } from './modules/files/files.module';

@Module({
  imports: [
    FilesModule, // Registro de mi modulo (miguel) para que funcion
    // En el futuro, agregarán aquí IamModule, BillingModule, etc.
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}