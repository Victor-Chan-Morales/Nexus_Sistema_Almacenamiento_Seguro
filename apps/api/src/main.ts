import { NestFactory } from '@nestjs/core';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';

const logger = new Logger('Bootstrap');
// Se declara fuera de bootstrap para poder cerrarla si el arranque falla después de crearla.
let app: INestApplication | undefined;

async function bootstrap() {
  app = await NestFactory.create(AppModule);

  // Prefijo global para todas las rutas del API
  app.setGlobalPrefix('api');

  // Habilitamos CORS para que el frontend Next.js pueda consumir el API.
  // `credentials: true` es obligatorio para que el navegador guarde y envíe la cookie
  // HttpOnly del refresh token (IAM); por eso `origin` debe ser explícito, nunca '*'.
  // `exposedHeaders` permite a la web leer el nombre de archivo de Content-Disposition en las descargas.
  app.enableCors({
    origin: process.env.WEB_URL ?? 'http://localhost:3000',
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
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

// Si el arranque falla (puerto ocupado, BD inaccesible), el proceso debe terminar con un error visible.
bootstrap().catch(async (error: unknown) => {
  logger.error('No se pudo iniciar la API', error instanceof Error ? error.stack : error);
  // Cerrar la app libera el pool de conexiones antes de salir.
  await app?.close();
  process.exit(1);
});
