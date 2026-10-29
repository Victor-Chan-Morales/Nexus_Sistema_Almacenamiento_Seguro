import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, Roles } from '../decorators/roles.decorator';
import { Role } from '../domain/enums';
import { RolesGuard } from './roles.guard';

/** ExecutionContext simulado: el guard solo usa getHandler, getClass y switchToHttp().getRequest(). */
const contextOf = (user: unknown, handler: object = {}, cls: object = {}) =>
  ({
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as never;

const forbidden = (fn: () => unknown): HttpException => {
  try {
    fn();
  } catch (err) {
    return err as HttpException;
  }
  throw new Error('Se esperaba 403 y el guard dejó pasar');
};

describe('RolesGuard (SPEC-101)', () => {
  const guard = new RolesGuard(new Reflector());
  const admin = { userId: 'u1', role: Role.TENANT_ADMIN };
  const colaborador = { userId: 'u2', role: Role.COLABORADOR };

  // Handlers reales decorados, para ejercitar Reflector de verdad.
  class AdminOnly {
    @Roles(Role.TENANT_ADMIN)
    handler() {}
  }
  class Undecorated {
    handler() {}
  }
  @Roles(Role.TENANT_ADMIN)
  class AdminClass {
    handler() {}
    @Roles(Role.COLABORADOR)
    override() {}
  }

  it('Escenario 1: rol requerido presente → permite', () => {
    const ctx = contextOf(admin, AdminOnly.prototype.handler, AdminOnly);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('Escenario 2: rol insuficiente → 403 FORBIDDEN_ROLE sin requiredRoles', () => {
    const ctx = contextOf(colaborador, AdminOnly.prototype.handler, AdminOnly);
    const err = forbidden(() => guard.canActivate(ctx));
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse()).toEqual({
      code: 'FORBIDDEN_ROLE',
      message: 'Tu rol no tiene permiso para esta acción.',
    });
    expect(err.getResponse()).not.toHaveProperty('requiredRoles');
  });

  it('Escenario 3: endpoint sin @Roles → permite a cualquier autenticado', () => {
    const ctx = contextOf(colaborador, Undecorated.prototype.handler, Undecorated);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('Escenario 3b: @Roles() vacío en el método no abre un endpoint restringido por la clase', () => {
    class EmptyOverride {
      @Roles()
      handler() {}
    }
    @Roles(Role.TENANT_ADMIN)
    class AdminClassEmptyOverride {
      @Roles()
      override() {}
    }
    const onMethod = AdminClassEmptyOverride.prototype.override;
    expect(forbidden(() => guard.canActivate(contextOf(admin, onMethod, AdminClassEmptyOverride))).getStatus()).toBe(403);
    expect(forbidden(() => guard.canActivate(contextOf(colaborador, onMethod, AdminClassEmptyOverride))).getStatus()).toBe(403);
    expect(forbidden(() => guard.canActivate(contextOf(admin, EmptyOverride.prototype.handler, EmptyOverride))).getStatus()).toBe(403);
  });

  it('Escenario 3c: sin req.user y sin @Roles → 403 (el guard no deja pasar sin autenticación)', () => {
    const ctx = contextOf(undefined, Undecorated.prototype.handler, Undecorated);
    expect(forbidden(() => guard.canActivate(ctx)).getResponse()).toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('Escenario 3d: metadatos que no son un array → 403 (no hay búsqueda de subcadena)', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('TENANT_ADMIN') };
    const ctx = contextOf(admin);
    expect(forbidden(() => new RolesGuard(reflector as never).canActivate(ctx)).getStatus()).toBe(403);
  });

  it('Escenario 4: falla cerrada sin req.user', () => {
    const ctx = contextOf(undefined, AdminOnly.prototype.handler, AdminOnly);
    expect(forbidden(() => guard.canActivate(ctx)).getResponse()).toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('Escenario 4: falla cerrada con un rol desconocido', () => {
    const ctx = contextOf({ userId: 'u3', role: 'auditor' }, AdminOnly.prototype.handler, AdminOnly);
    expect(forbidden(() => guard.canActivate(ctx)).getResponse()).toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('Escenario 5: el decorador del método prevalece sobre el de la clase', () => {
    const onMethod = AdminClass.prototype.override;
    expect(guard.canActivate(contextOf(colaborador, onMethod, AdminClass))).toBe(true);
    expect(forbidden(() => guard.canActivate(contextOf(admin, onMethod, AdminClass))).getStatus()).toBe(403);
  });

  it('Escenario 5b: sin decorador en el método se aplica el de la clase', () => {
    const onClass = AdminClass.prototype.handler;
    expect(guard.canActivate(contextOf(admin, onClass, AdminClass))).toBe(true);
    expect(forbidden(() => guard.canActivate(contextOf(colaborador, onClass, AdminClass))).getStatus()).toBe(403);
  });

  it('el decorador guarda los roles bajo ROLES_KEY', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminOnly.prototype.handler)).toEqual([Role.TENANT_ADMIN]);
  });
});
