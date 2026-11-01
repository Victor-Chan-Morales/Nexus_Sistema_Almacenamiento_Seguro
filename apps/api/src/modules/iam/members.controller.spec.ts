import { BadRequestException, HttpException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './decorators/roles.decorator';
import { Role } from './domain/enums';
import { AddMemberDto } from './dto/add-member.dto';
import { RolesGuard } from './guards/roles.guard';
import { MembersController } from './members.controller';

const contextOf = (user: unknown, handler: object = MembersController.prototype.addMember) =>
  ({
    getHandler: () => handler,
    getClass: () => MembersController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as never;

const colaborador = { userId: 'u2', organizationId: 'ORG-1', role: Role.COLABORADOR };
const admin = { userId: 'u1', organizationId: 'ORG-1', role: Role.TENANT_ADMIN };
const BODY = { fullName: 'Ana Pérez', email: 'ana@empresa.com', role: 'colaborador' };

/** Mismas opciones que la ValidationPipe global de la API (forbidNonWhitelisted). */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: AddMemberDto }) as Promise<AddMemberDto>;

describe('MembersController (POST /organizations/members)', () => {
  it('Escenario 2: el endpoint exige tenant_admin y un colaborador recibe 403 FORBIDDEN_ROLE', () => {
    expect(Reflect.getMetadata(ROLES_KEY, MembersController.prototype.addMember)).toEqual([Role.TENANT_ADMIN]);

    const guard = new RolesGuard(new Reflector());
    let error: HttpException | undefined;
    try {
      guard.canActivate(contextOf(colaborador));
    } catch (err) {
      error = err as HttpException;
    }
    expect(error?.getStatus()).toBe(403);
    expect(error?.getResponse()).toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('Escenario 2: el guard permite al tenant_admin; el handler solo se alcanza después del guard', () => {
    expect(new RolesGuard(new Reflector()).canActivate(contextOf(admin))).toBe(true);
  });

  it('delega en el servicio con el actor autenticado y el cuerpo validado', async () => {
    const result = { id: 'm1' };
    const service = { addMember: jest.fn().mockResolvedValue(result) };
    const controller = new MembersController(service as never);
    const dto = await validate(BODY);

    expect(await controller.addMember(admin as never, dto)).toBe(result);
    expect(service.addMember).toHaveBeenCalledWith(admin, dto);
  });

  it('Escenario 7: un organizationId en el cuerpo se rechaza (forbidNonWhitelisted)', async () => {
    await expect(validate({ ...BODY, organizationId: 'ORG-AJENA' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza nombre corto, correo inválido y rol fuera del enum', async () => {
    await expect(validate({ ...BODY, fullName: 'A' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ ...BODY, email: 'no-es-correo' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ ...BODY, role: 'auditor' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ ...BODY, role: 'super_admin' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('acepta ambos roles del contrato y recorta espacios', async () => {
    const dto = await validate({ fullName: '  Ana Pérez  ', email: ' ana@empresa.com ', role: 'tenant_admin' });
    expect(dto).toMatchObject({ fullName: 'Ana Pérez', email: 'ana@empresa.com', role: Role.TENANT_ADMIN });
  });

  it('SPEC-104 Escenario 3: GET exige tenant_admin y un colaborador recibe 403 FORBIDDEN_ROLE', () => {
    const handler = MembersController.prototype.list;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([Role.TENANT_ADMIN]);

    const guard = new RolesGuard(new Reflector());
    let error: HttpException | undefined;
    try {
      guard.canActivate(contextOf(colaborador, handler));
    } catch (err) {
      error = err as HttpException;
    }
    expect(error?.getStatus()).toBe(403);
    expect(error?.getResponse()).toMatchObject({ code: 'FORBIDDEN_ROLE' });
    expect(new RolesGuard(new Reflector()).canActivate(contextOf(admin, handler))).toBe(true);
  });

  it('SPEC-104: GET delega en el servicio con el actor del token (sin parámetros de organización)', async () => {
    const result = { members: [], totalMembers: 0, userLimit: null };
    const service = { list: jest.fn().mockResolvedValue(result) };
    const controller = new MembersController(service as never);

    expect(await controller.list(admin as never)).toBe(result);
    expect(service.list).toHaveBeenCalledWith(admin);
    expect(MembersController.prototype.list.length).toBe(1); // solo recibe al actor
  });
});
