import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Errores de IAM. Llevan { code, message } y el filtro global agrega requestId,
 * produciendo el formato común de CONTRACTS.md: { code, message, requestId }.
 * Los mensajes son seguros y uniformes (no revelan si un correo existe).
 */
export const IamErrors = {
  emailTaken: () =>
    new ConflictException({ code: 'EMAIL_ALREADY_REGISTERED', message: 'El correo ya está registrado' }),
  invalidCredentials: () =>
    new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Credenciales inválidas' }),
  invalidSession: () =>
    new UnauthorizedException({ code: 'INVALID_SESSION', message: 'Sesión inválida o vencida' }),
  unauthorized: () =>
    new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'No autenticado' }),
  invalidVerificationToken: () =>
    new BadRequestException({
      code: 'INVALID_VERIFICATION_TOKEN',
      message: 'Token de verificación inválido o vencido',
    }),
  emailNotVerified: () =>
    new ForbiddenException({
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Debes verificar tu correo antes de iniciar sesión',
    }),
  mfaNotSupported: () =>
    new ForbiddenException({
      code: 'MFA_NOT_SUPPORTED',
      message: 'La verificación en dos pasos aún no está disponible para esta cuenta',
    }),
  forbiddenRole: () =>
    new ForbiddenException({
      code: 'FORBIDDEN_ROLE',
      message: 'Tu rol no tiene permiso para esta acción.',
    }),
  noActiveMembership: () =>
    new ForbiddenException({
      code: 'NO_ACTIVE_MEMBERSHIP',
      message: 'La cuenta no tiene una organización activa',
    }),
} as const;
