import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Response } from 'express';

/**
 * Error común de CONTRACTS.md: { code, message, requestId }.
 * - Solo se reenvía el mensaje de errores que el propio backend redactó con `code`.
 * - Cualquier otro error (validación, Nest, excepciones inesperadas) sale con mensaje genérico:
 *   sin stack trace, secretos, rutas internas ni datos de otro tenant.
 * El requestId lo genera el servidor (nunca se confía en uno enviado por el cliente).
 */
const DEFAULTS: Record<number, { code: string; message: string }> = {
  400: { code: 'VALIDATION_ERROR', message: 'Datos ausentes o mal formados' },
  401: { code: 'UNAUTHORIZED', message: 'No autenticado' },
  403: { code: 'FORBIDDEN', message: 'No tienes permiso para esta operación' },
  404: { code: 'NOT_FOUND', message: 'Recurso no encontrado' },
  409: { code: 'CONFLICT', message: 'Conflicto con el estado actual del recurso' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'La solicitud es demasiado grande' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Tipo de contenido no permitido' },
  422: { code: 'BUSINESS_RULE_VIOLATION', message: 'La operación no cumple una regla de negocio' },
  429: { code: 'TOO_MANY_REQUESTS', message: 'Demasiados intentos, inténtalo más tarde' },
};
const INTERNAL = { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' };

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = randomUUID();

    let status = 500;
    let { code, message } = INTERNAL;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const fallback = status >= 500 ? INTERNAL : (DEFAULTS[status] ?? INTERNAL);
      code = fallback.code;
      message = fallback.message;

      const payload = exception.getResponse();
      if (typeof payload === 'object' && payload !== null) {
        const own = payload as { code?: unknown; message?: unknown };
        if (typeof own.code === 'string' && typeof own.message === 'string' && status < 500) {
          code = own.code;
          message = own.message;
        }
      }
    }

    if (status >= 500) {
      const detail = exception instanceof Error ? (exception.stack ?? exception.message) : 'desconocido';
      this.logger.error(`requestId=${requestId} ${detail}`);
    }

    res.setHeader('X-Request-Id', requestId);
    res.status(status).json({ code, message, requestId });
  }
}
