import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Decorador @CurrentUser()
 *
 * Extrae el usuario autenticado del contexto del request.
 * Uso en controladores:
 *   @Get('perfil')
 *   @UseGuards(AuthGuard('jwt'))
 *   getProfile(@CurrentUser() user: RequestUser) { ... }
 */
export interface RequestUser {
  userId: string;
  email: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
