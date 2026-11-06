import { BadRequestException, HttpException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../domain/enums';
import { AddMemberDto } from '../dto/add-member.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { LoginDto } from '../dto/login.dto';
import { RegisterDto } from '../dto/register.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { RolesGuard } from './roles.guard';
import { SuperAdminGuard } from './super-admin.guard';

const contextOf = (user: unknown, handler: object = {}, cls: object = {}) =>
  ({
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as never;

const denial = (fn: () => unknown): HttpException => {
  try {
    fn();
  } catch (err) {
    return err as HttpException;
  }
  throw new Error('Se esperaba 403 y el guard dejó pasar');
};

const base = { userId: 'u1', organizationId: 'o1', email: 'a@b.co', fullName: 'A', organizationName: 'O' };

describe('SuperAdminGuard (SPEC-501)', () => {
  const guard = new SuperAdminGuard();

  it('Super Admin → permite', () => {
    expect(guard.canActivate(contextOf({ ...base, role: Role.TENANT_ADMIN, isSuperAdmin: true }))).toBe(true);
  });

  it.each([
    ['tenant_admin sin ser Super Admin', { ...base, role: Role.TENANT_ADMIN, isSuperAdmin: false }],
    ['colaborador', { ...base, role: Role.COLABORADOR, isSuperAdmin: false }],
    ['sin el campo', { ...base, role: Role.TENANT_ADMIN }],
    ['sin usuario', undefined],
    ['isSuperAdmin como texto "true"', { ...base, role: Role.TENANT_ADMIN, isSuperAdmin: 'true' }],
    ['isSuperAdmin como 1', { ...base, role: Role.TENANT_ADMIN, isSuperAdmin: 1 }],
  ])('Escenario 5: %s → 403 PLATFORM_ADMIN_REQUIRED (falla cerrada)', (_name, user) => {
    const err = denial(() => guard.canActivate(contextOf(user)));
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse()).toEqual({
      code: 'PLATFORM_ADMIN_REQUIRED',
      message: 'Esta acción es exclusiva del administrador de la plataforma.',
    });
  });

  it('Escenario 8: ser Super Admin no sustituye el rol de organización (RolesGuard sigue mandando)', () => {
    class AdminOnly {
      @Roles(Role.TENANT_ADMIN)
      handler() {}
    }
    const rolesGuard = new RolesGuard(new Reflector());
    const superAdminColaborador = { ...base, role: Role.COLABORADOR, isSuperAdmin: true };
    const err = denial(() => rolesGuard.canActivate(contextOf(superAdminColaborador, AdminOnly.prototype.handler, AdminOnly)));
    expect(err.getResponse()).toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('Escenario 8: la organización sigue siendo la del token, no hay selector ni bypass', () => {
    const user = { ...base, role: Role.TENANT_ADMIN, isSuperAdmin: true };
    guard.canActivate(contextOf(user));
    expect(user.organizationId).toBe('o1'); // el guard no lee ni modifica el tenant
  });
});

describe('Escenario 6: ninguna ruta ni DTO permite asignar is_super_admin', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const valid: Array<[string, new () => object, Record<string, unknown>]> = [
    ['RegisterDto', RegisterDto, { fullName: 'Ana Pérez', email: 'a@b.co', password: 'Password123', organizationName: 'Empresa' }],
    ['AddMemberDto', AddMemberDto, { fullName: 'Ana Pérez', email: 'a@b.co', role: 'colaborador' }],
    ['LoginDto', LoginDto, { email: 'a@b.co', password: 'Password123' }],
    ['ForgotPasswordDto', ForgotPasswordDto, { email: 'a@b.co' }],
    ['ResetPasswordDto', ResetPasswordDto, { token: 'token-en-claro-de-mas-de-veinte-caracteres', newPassword: 'Password123' }],
  ];

  it.each(valid)('%s rechaza isSuperAdmin e is_super_admin en el cuerpo', async (_name, metatype, body) => {
    await expect(pipe.transform(body, { type: 'body', metatype })).resolves.toBeDefined(); // el cuerpo base es válido
    for (const field of ['isSuperAdmin', 'is_super_admin']) {
      await expect(pipe.transform({ ...body, [field]: true }, { type: 'body', metatype })).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('AddMemberDto tampoco acepta un rol super_admin', async () => {
    await expect(
      pipe.transform({ fullName: 'Ana Pérez', email: 'a@b.co', role: 'super_admin' }, { type: 'body', metatype: AddMemberDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
