import { BadRequestException, HttpException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './constants';
import { Role } from './domain/enums';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { IamController } from './iam.controller';
import { IamErrors } from './iam.errors';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthUser } from './interfaces/auth-user.interface';

/** Mismas opciones que el pipe global de main.ts. */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = <T>(body: unknown, metatype: new () => T) =>
  pipe.transform(body, { type: 'body', metatype }) as Promise<T>;

/** Cuerpo del error como texto, para comprobar mensajes y códigos. */
const rejectionOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (err) {
    return JSON.stringify((err as HttpException).getResponse());
  }
  return 'ACEPTADO';
};

const TEXTO_POLITICA = 'La contraseña debe incluir letras y números';

describe('SPEC-113: ChangePasswordDto (escenario 4)', () => {
  it.each([
    ['de 7 caracteres', 'Abc1234'],
    ['sin número', 'sololetrasaaaaa'],
    ['sin letras', '12345678'],
    ['de 129 caracteres', `a1${'x'.repeat(127)}`],
  ])('nueva contraseña %s → 400 VALIDATION_ERROR', async (_caso, newPassword) => {
    await expect(validate({ currentPassword: 'Vieja1234', newPassword }, ChangePasswordDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('la nueva contraseña sin número responde 400 con el texto de la política en español', async () => {
    const error = await validate({ currentPassword: 'Vieja1234', newPassword: 'sololetrasaaaaa' }, ChangePasswordDto).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify((error as BadRequestException).getResponse())).toContain(TEXTO_POLITICA);
  });

  it('acepta una nueva contraseña válida sin recortarla', async () => {
    const dto = await validate({ currentPassword: ' Vieja 1 ', newPassword: 'NuevaClave123' }, ChangePasswordDto);
    expect(dto.currentPassword).toBe(' Vieja 1 ');
    expect(dto.newPassword).toBe('NuevaClave123');
  });

  it('la contraseña actual solo se valida como texto de 1 a 128 caracteres: una antigua que no cumple la política sigue sirviendo', async () => {
    await expect(validate({ currentPassword: 'corta', newPassword: 'NuevaClave123' }, ChangePasswordDto)).resolves.toBeDefined();
    await expect(validate({ currentPassword: '', newPassword: 'NuevaClave123' }, ChangePasswordDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      validate({ currentPassword: 'x'.repeat(129), newPassword: 'NuevaClave123' }, ChangePasswordDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un campo no declarado (p. ej. userId) con 400', async () => {
    await expect(
      validate({ currentPassword: 'Vieja1234', newPassword: 'NuevaClave123', userId: 'u9' }, ChangePasswordDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SPEC-113: UpdateProfileDto (escenario 1 y §5 del contrato)', () => {
  it('recorta los espacios del nombre antes de validar y guardar', async () => {
    const dto = await validate({ fullName: '  Ana Pérez  ' }, UpdateProfileDto);
    expect(dto.fullName).toBe('Ana Pérez');
  });

  it('acepta nombres de 2 y de 120 caracteres', async () => {
    await expect(validate({ fullName: 'Al' }, UpdateProfileDto)).resolves.toBeDefined();
    await expect(validate({ fullName: 'x'.repeat(120) }, UpdateProfileDto)).resolves.toBeDefined();
  });

  it.each([
    ['de 1 carácter', 'A'],
    ['de 1 carácter tras recortar', '  A  '],
    ['de 121 caracteres', 'x'.repeat(121)],
  ])('rechaza un nombre %s con 400', async (_caso, fullName) => {
    await expect(validate({ fullName }, UpdateProfileDto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza el correo en el cuerpo: PATCH /auth/me solo cambia el nombre (400 por forbidNonWhitelisted)', async () => {
    const texto = await rejectionOf(validate({ fullName: 'Ana Pérez', email: 'otro@nexus.com' }, UpdateProfileDto));
    expect(texto).toContain('email');
  });

  it('rechaza un cuerpo sin nombre o con un nombre que no es texto', async () => {
    await expect(validate({}, UpdateProfileDto)).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ fullName: 123 }, UpdateProfileDto)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SPEC-113: controlador de /auth/me y /auth/change-password', () => {
  const actor: AuthUser = {
    userId: 'u1',
    organizationId: 'o1',
    role: Role.TENANT_ADMIN,
    email: 'ana@nexus.com',
    fullName: 'Ana',
    organizationName: 'Empresa',
    isSuperAdmin: false,
  };

  const controllerWith = (account: unknown) =>
    new IamController(
      {} as never,
      {} as never,
      {} as never,
      { refreshCookie: { secure: false, sameSite: 'lax' } } as never,
      {} as never,
      {} as never,
      account as never,
    );

  describe('PATCH /auth/me', () => {
    it('Escenario 1: responde el MeResponse con el nombre guardado, sin passwordHash', async () => {
      const account = { updateProfile: jest.fn().mockResolvedValue('Ana Pérez') };
      const body = await controllerWith(account).updateMe(actor, { fullName: 'Ana Pérez' } as UpdateProfileDto);

      expect(account.updateProfile).toHaveBeenCalledWith(actor, 'Ana Pérez');
      expect(body).toEqual({
        user: { id: 'u1', fullName: 'Ana Pérez', email: 'ana@nexus.com' },
        organization: { id: 'o1', name: 'Empresa' },
        role: 'tenant_admin',
        isSuperAdmin: false,
      });
      expect(JSON.stringify(body)).not.toContain('passwordHash');
    });

    it('la forma de la respuesta es la misma que GET /auth/me (incluye isSuperAdmin)', async () => {
      const account = { updateProfile: jest.fn().mockResolvedValue('Ana Pérez') };
      const controller = controllerWith(account);
      const superAdmin = { ...actor, isSuperAdmin: true };

      const patched = await controller.updateMe(superAdmin, { fullName: 'Ana Pérez' } as UpdateProfileDto);
      const current = controller.me(superAdmin);

      expect(Object.keys(patched).sort()).toEqual(Object.keys(current).sort());
      expect(patched.isSuperAdmin).toBe(true);
      expect(Object.keys(patched.user).sort()).toEqual(['email', 'fullName', 'id']);
    });
  });

  describe('POST /auth/change-password', () => {
    const dto = { currentPassword: 'Vieja1234', newPassword: 'NuevaClave123' } as ChangePasswordDto;

    it('Escenario 2: responde 204 y borra la cookie de refresh con el path de autenticación', async () => {
      const account = { changePassword: jest.fn().mockResolvedValue(undefined) };
      const res = { clearCookie: jest.fn() };

      await expect(controllerWith(account).changePassword(actor, dto, res as never)).resolves.toBeUndefined();

      expect(account.changePassword).toHaveBeenCalledWith(actor, dto);
      expect(res.clearCookie).toHaveBeenCalledTimes(1);
      expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: REFRESH_COOKIE_PATH,
      });
      expect(REFRESH_COOKIE_PATH).toBe('/api/auth');
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, IamController.prototype.changePassword)).toBe(204);
    });

    it('Escenario 3: si la contraseña actual es incorrecta, no borra la cookie (la sesión sigue activa)', async () => {
      const account = { changePassword: jest.fn().mockRejectedValue(IamErrors.invalidCredentials()) };
      const res = { clearCookie: jest.fn() };

      expect(await rejectionOf(controllerWith(account).changePassword(actor, dto, res as never))).toContain(
        'INVALID_CREDENTIALS',
      );
      expect(res.clearCookie).not.toHaveBeenCalled();
    });
  });
  describe('protección de rutas (SPEC-113 §5: Bearer obligatorio)', () => {
    it.each([
      ['PATCH /auth/me', IamController.prototype.updateMe],
      ['POST /auth/change-password', IamController.prototype.changePassword],
    ])('%s exige JwtAuthGuard', (_route, handler) => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined;
      expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard]));
    });
  });
});
