import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error de negocio con código estable. `ApiExceptionFilter` reenvía `code` y `message` cuando el estado es menor que 500.
 * Los servicios de dominio lo usan a través de fábricas con nombre (p. ej. `destinationInUseError`).
 */
export function businessError(status: HttpStatus, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, error: HttpStatus[status] ?? 'Error', code, message }, status);
}
