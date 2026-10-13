import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Prefijo global para todas las rutas del API
  app.setGlobalPrefix('api');

  // Habilitamos CORS para que el frontend Next.js pueda consumir el API.
  // `credentials: true` es obligatorio para que el navegador guarde y envíe la cookie
  // HttpOnly del refresh token (IAM); por eso `origin` debe ser explícito, nunca '*'.
  app.enableCors({
    origin: process.env.WEB_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  // Validación automática de DTOs con class-validator.
  // forbidNonWhitelisted rechaza campos no declarados (p. ej. un organizationId enviado por el navegador).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Error común de CONTRACTS.md: { code, message, requestId } (sin stack ni datos internos)
  app.useGlobalFilters(new ApiExceptionFilter());

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
  console.log(`Nexus API corriendo en http://localhost:${port}/api`);
}

bootstrap();
