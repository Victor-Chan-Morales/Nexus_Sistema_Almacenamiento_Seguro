import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Filtro de Excepciones Global / Modular de Nexus API
 *
 * Intercepta todas las excepciones y garantiza el formato canónico exigido por CONTRACTS.md:
 * {
 *   "code": "ERROR_CODE",
 *   "message": "Mensaje seguro",
 *   "requestId": "uuid"
 * }
 *
 * Protege contra fugas de stack traces, secretos o datos de otros tenants.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Obtener requestId del header X-Request-Id o generar uno nuevo en formato UUID
    const requestId =
      (request.headers['x-request-id'] as string) ||
      (request as any).id ||
      randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'Ha ocurrido un error inesperado en el servidor.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        code = this.mapStatusToCode(status);
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const respObj = exceptionResponse as Record<string, any>;

        // Si la excepción ya trae un código de error de negocio explícito
        if (respObj.code && typeof respObj.code === 'string') {
          code = respObj.code;
        } else {
          code = this.mapStatusToCode(status);
        }

        // Extraer mensaje limpio (soporta validaciones de class-validator)
        if (Array.isArray(respObj.message)) {
          message = respObj.message.join('; ');
        } else if (typeof respObj.message === 'string') {
          message = respObj.message;
        } else if (respObj.error && typeof respObj.error === 'string') {
          message = respObj.error;
        }
      }
    } else {
      // Manejo específico de errores de base de datos PostgreSQL / TypeORM
      const err = exception as any;
      if (err?.code === '23505' || err?.driverError?.code === '23505') {
        // Violación de restricción única (ej. índice parcial uq_active_org_subscription)
        status = HttpStatus.CONFLICT;
        code = 'CONCURRENT_SUBSCRIPTION_CONFLICT';
        message = 'Ya existe una suscripción activa para esta organización o hay una operación concurrente en curso.';
      } else {
        this.logger.error(
          `Error no controlado [requestId: ${requestId}]: ${err?.message || exception}`,
          err?.stack,
        );
      }
    }

    // Emitir estrictamente { code, message, requestId }
    response.status(status).json({
      code,
      message,
      requestId,
    });
  }

  private mapStatusToCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return 'PAYLOAD_TOO_LARGE';
      case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
        return 'UNSUPPORTED_MEDIA_TYPE';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'UNPROCESSABLE_ENTITY';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'TOO_MANY_REQUESTS';
      default:
        return 'INTERNAL_SERVER_ERROR';
    }
  }
}
