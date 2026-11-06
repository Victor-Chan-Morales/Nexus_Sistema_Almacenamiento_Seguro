import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { IamErrors } from '../iam.errors';
import { AuthUser } from '../interfaces/auth-user.interface';

/**
 * Exclusivo del dueño de la plataforma (SPEC-501). Va DESPUÉS del guard JWT: sin sesión ese guard ya responde 401.
 * `req.user.isSuperAdmin` lo arma JwtStrategy con iam.user.is_super_admin leído de la BD en cada request.
 * Falla cerrada: sin usuario, o con cualquier valor distinto de `true`, responde 403 PLATFORM_ADMIN_REQUIRED.
 * No altera el rol de organización: un Super Admin sin rol tenant_admin en otra organización no opera en ella.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (user?.isSuperAdmin !== true) throw IamErrors.platformAdminRequired();
    return true;
  }
}
