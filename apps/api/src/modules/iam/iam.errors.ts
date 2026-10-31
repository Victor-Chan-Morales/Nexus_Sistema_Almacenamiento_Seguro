import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  UnprocessableEntityException,
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
  invalidOrExpiredToken: () =>
    new BadRequestException({
      code: 'INVALID_OR_EXPIRED_TOKEN',
      message: 'El enlace es inválido o venció. Solicita uno nuevo.',
    }),
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
  memberAlreadyExists: () =>
    new UnprocessableEntityException({
      code: 'MEMBER_ALREADY_EXISTS',
      message: 'Esta persona ya es miembro de la organización',
    }),
  emailBelongsToOtherOrganization: () =>
    new UnprocessableEntityException({
      code: 'EMAIL_BELONGS_TO_OTHER_ORGANIZATION',
      message: 'El correo ya pertenece a una cuenta de otra organización',
    }),
  userLimitExceeded: () =>
    new UnprocessableEntityException({
      code: 'USER_LIMIT_EXCEEDED',
      message: 'La organización alcanzó el límite de usuarios de su plan',
    }),
  noActiveMembership: () =>
    new ForbiddenException({
      code: 'NO_ACTIVE_MEMBERSHIP',
      message: 'La cuenta no tiene una organización activa',
    }),
} as const;
