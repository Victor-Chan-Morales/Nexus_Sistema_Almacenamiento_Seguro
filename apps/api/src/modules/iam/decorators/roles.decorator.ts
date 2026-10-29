import { SetMetadata } from '@nestjs/common';
import { Role } from '../domain/enums';

export const ROLES_KEY = 'roles';

/**
 * Restringe un endpoint (o un controlador completo) a los roles indicados.
 * Se usa junto con RolesGuard: @UseGuards(JwtAuthGuard, RolesGuard).
 * El parámetro es el enum Role: un valor mal escrito no compila.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
