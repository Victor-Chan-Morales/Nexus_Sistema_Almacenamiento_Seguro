import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Habilitamos CORS para que el Next.js de Víctor pueda enviarnos archivos
  app.enableCors();

  // Levantamos la API en el puerto 3001 (para que no choque con el frontend ni con MinIO)
  await app.listen(3001);
  console.log(`🚀 API de Nexus corriendo en http://localhost:3001`);
}
bootstrap();