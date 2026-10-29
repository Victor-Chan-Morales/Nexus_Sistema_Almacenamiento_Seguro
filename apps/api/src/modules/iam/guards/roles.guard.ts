import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../domain/enums';
import { IamErrors } from '../iam.errors';
import { AuthUser } from '../interfaces/auth-user.interface';

/**
 * Autoriza por rol de la membresía activa (req.user.role, que JwtStrategy lee de la BD en cada request).
 * Debe ir DESPUÉS del guard JWT: @UseGuards(JwtAuthGuard, RolesGuard).
 * Falla cerrada: con @Roles presente, sin usuario o con un rol desconocido responde 403 FORBIDDEN_ROLE.
 * El cuerpo del 403 no revela los roles requeridos (CONTRACTS.md v0.5).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // El decorador del método prevalece sobre el de la clase.
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!user || !required.includes(user.role as Role)) throw IamErrors.forbiddenRole();
    return true;
  }
}
