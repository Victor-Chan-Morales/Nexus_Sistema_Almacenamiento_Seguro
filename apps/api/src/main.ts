import { NestFactory } from '@nestjs/core';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';

const logger = new Logger('Bootstrap');

// Tiempo máximo para cerrar la app tras un fallo de arranque; un cierre colgado no debe dejar el proceso vivo.
const CLOSE_TIMEOUT_MS = 5000;

async function bootstrap() {
  // abortOnError: false hace que un fallo dentro de create (p. ej. BD inaccesible) se propague
  // como rechazo; por defecto Nest llama a process.exit(1) y se salta el manejo de abajo.
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  try {
    await configureAndListen(app);
  } catch (error: unknown) {
    // Si el proceso terminara solo durante el cierre, saldría igualmente con error.
    process.exitCode = 1;
    // Cerrar la app libera el pool de conexiones antes de salir.
    await closeWithTimeout(app);
    throw error;
  }
}

async function configureAndListen(app: INestApplication) {
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
  logger.log(`Nexus API corriendo en http://localhost:${port}/api`);
}

async function closeWithTimeout(app: INestApplication) {
  let timer: NodeJS.Timeout | undefined;
  try {
    // El temporizador no usa unref(): mantiene vivo el proceso hasta que el catch final llame a process.exit(1).
    await Promise.race([
      app.close(),
      new Promise((resolve) => (timer = setTimeout(resolve, CLOSE_TIMEOUT_MS))),
    ]);
  } catch (closeError: unknown) {
    logger.error(
      'No se pudo cerrar la API tras el fallo de arranque',
      closeError instanceof Error ? closeError.stack : closeError,
    );
  } finally {
    clearTimeout(timer);
  }
}

// Si el arranque falla (puerto ocupado, BD inaccesible), el proceso debe terminar con un error visible.
bootstrap().catch((error: unknown) => {
  logger.error('No se pudo iniciar la API', error instanceof Error ? error.stack : error);
  process.exit(1);
});
