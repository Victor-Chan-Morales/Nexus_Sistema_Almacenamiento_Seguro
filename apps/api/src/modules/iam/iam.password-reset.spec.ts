import { BadRequestException, HttpException, Logger, ValidationPipe } from '@nestjs/common';
import { PASSWORD_RESET_TOKEN_TTL_MINUTES } from './constants';
import { TokenPurpose, UserStatus } from './domain/enums';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { IamController } from './iam.controller';
import { PasswordResetService } from './services/password-reset.service';

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (err) {
    return (err as HttpException).getResponse()['code'] as string;
  }
  return 'NO_ERROR';
};

const TOKEN = 'token-en-claro-de-mas-de-veinte-caracteres';
const GENERIC = 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.';

/** requestReset responde antes de procesar: el trabajo en segundo plano termina en el siguiente turno. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

const activeUser = { id: 'u1', email: 'usuario@nexus.com', fullName: 'Ana', status: UserStatus.ACTIVE };

interface Options {
  user?: typeof activeUser | null;
  record?: Record<string, unknown> | null;
  failOn?: 'revoke' | 'markUsed';
}

/** Orden de las operaciones y estado simulado con rollback, para probar atomicidad y secuencia. */
const build = (opts: Options = {}) => {
  const log: string[] = [];
  const state = { passwordHash: 'hash-viejo', emailVerified: false, tokenUsed: false, sessionsRevoked: false };

  const uow = {
    run: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => {
      const before = { ...state };
      try {
        const result = await work('tx');
        log.push('commit');
        return result;
      } catch (err) {
        Object.assign(state, before);
        log.push('rollback');
        throw err;
      }
    }),
  };
  const users = {
    findByEmail: jest.fn().mockResolvedValue(opts.user === undefined ? activeUser : opts.user),
    findById: jest.fn().mockResolvedValue(opts.user === undefined ? activeUser : opts.user),
    setPasswordAndVerifyEmail: jest.fn(async (_tx: unknown, _id: string, hash: string) => {
      state.passwordHash = hash;
      state.emailVerified = true;
      log.push('password');
    }),
  };
  const record =
    opts.record === undefined
      ? { id: 't1', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() + 10 * 60_000) }
      : opts.record;
  const tokensRepo = {
    findByHashForUpdate: jest.fn().mockResolvedValue(record),
    markUsed: jest.fn(async () => {
      if (opts.failOn === 'markUsed') throw new Error('falla');
      state.tokenUsed = true;
      log.push('markUsed');
    }),
    invalidateUnused: jest.fn(async () => void log.push('invalidate')),
  };
  const sessions = {
    revokeAllActiveOf: jest.fn(async () => {
      if (opts.failOn === 'revoke') throw new Error('falla');
      state.sessionsRevoked = true;
      log.push('revoke');
    }),
  };
  const hasher = { hash: jest.fn(async (plain: string) => `argon2id:${plain}`) };
  const opaque = { hash: jest.fn((token: string) => `sha:${token}`) };
  const outbox = {
    // Emite el token (solo su hash) y encola el mensaje, dentro de la transacción.
    enqueueWithToken: jest.fn(async () => (log.push('enqueue'), 'outbox-1')),
    dispatch: jest.fn(async () => void log.push('dispatch')),
  };

  const service = new PasswordResetService(
    uow as never,
    users as never,
    tokensRepo as never,
    sessions as never,
    hasher as never,
    opaque as never,
    outbox as never,
  );
  return { service, log, state, uow, users, tokensRepo, sessions, hasher, opaque, outbox };
};

describe('PasswordResetService.requestReset', () => {
  it('Escenario 1: invalida tokens previos, emite uno de 15 min y encola password_reset, todo en una transacción', async () => {
    const t = build();
    await t.service.requestReset(' USUARIO@Nexus.com ');
    await flush();

    expect(t.uow.run).toHaveBeenCalledTimes(1);
    expect(t.users.findByEmail).toHaveBeenCalledWith('usuario@nexus.com', 'tx'); // correo normalizado
    expect(t.tokensRepo.invalidateUnused).toHaveBeenCalledWith('tx', 'u1', TokenPurpose.PASSWORD_RESET);
    expect(PASSWORD_RESET_TOKEN_TTL_MINUTES).toBe(15);
    expect(t.outbox.enqueueWithToken).toHaveBeenCalledWith('tx', {
      kind: 'password_reset',
      userId: 'u1',
      recipientEmail: 'usuario@nexus.com',
      recipientName: 'Ana',
      purpose: TokenPurpose.PASSWORD_RESET,
      ttlMinutes: PASSWORD_RESET_TOKEN_TTL_MINUTES,
    });
    // invalidar antes de emitir (si no, se invalidaría el token recién creado); envío después del commit
    expect(t.log).toEqual(['invalidate', 'enqueue', 'commit', 'dispatch']);
  });

  it('Escenario 1: el despacho no se espera (un envío lento no retrasa la respuesta)', async () => {
    const t = build();
    t.outbox.dispatch.mockImplementation(() => new Promise<void>(() => undefined)); // nunca resuelve
    await expect(t.service.requestReset('usuario@nexus.com')).resolves.toBeUndefined();
  });

  it('responde aunque la transacción no termine: el trabajo va en segundo plano', async () => {
    const t = build();
    t.uow.run.mockImplementationOnce(() => new Promise(() => undefined)); // nunca resuelve
    await expect(t.service.requestReset('usuario@nexus.com')).resolves.toBeUndefined();
  });

  it('Escenario 2: correo no registrado → no crea token ni mensaje ni despacha', async () => {
    const t = build({ user: null });
    await expect(t.service.requestReset('noexiste@nexus.com')).resolves.toBeUndefined();
    await flush();
    expect(t.tokensRepo.invalidateUnused).not.toHaveBeenCalled();
    expect(t.outbox.enqueueWithToken).not.toHaveBeenCalled();
    expect(t.outbox.enqueueWithToken).not.toHaveBeenCalled();
    expect(t.outbox.dispatch).not.toHaveBeenCalled();
  });

  it.each([UserStatus.INACTIVE, UserStatus.LOCKED])('Escenario 2: cuenta %s → trato idéntico a no registrada', async (status) => {
    const t = build({ user: { ...activeUser, status } });
    await t.service.requestReset('usuario@nexus.com');
    await flush();
    expect(t.outbox.enqueueWithToken).not.toHaveBeenCalled();
    expect(t.outbox.dispatch).not.toHaveBeenCalled();
  });

  it('si falla encolar el mensaje no queda ni despacho (la transacción se revierte)', async () => {
    const t = build();
    t.outbox.enqueueWithToken.mockRejectedValueOnce(new Error('falla'));
    await expect(t.service.requestReset('usuario@nexus.com')).resolves.toBeUndefined();
    await flush();
    expect(t.outbox.dispatch).not.toHaveBeenCalled();
    expect(t.log).toContain('rollback');
  });

  it('un fallo interno se registra sin el correo ni el token y no llega a la respuesta', async () => {
    const t = build();
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    t.outbox.enqueueWithToken.mockRejectedValueOnce(Object.assign(new Error('falla con correo@x.com'), { name: 'DbError' }));
    await expect(t.service.requestReset('usuario@nexus.com')).resolves.toBeUndefined();
    await flush();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][0]).toBe('Fallo al procesar la recuperación de contraseña: DbError');
    expect(String(logged.mock.calls[0][0])).not.toContain('correo@x.com');
    logged.mockRestore();
  });
});

describe('PasswordResetService.reset', () => {
  it('Escenario 3: reemplaza el hash (Argon2id), consume el token, verifica el correo y revoca todas las sesiones', async () => {
    const t = build();
    await t.service.reset(TOKEN, 'NuevaClave123');

    expect(t.opaque.hash).toHaveBeenCalledWith(TOKEN); // se busca por hash, nunca por el token en claro
    expect(t.tokensRepo.findByHashForUpdate).toHaveBeenCalledWith('tx', `sha:${TOKEN}`, TokenPurpose.PASSWORD_RESET);
    expect(t.hasher.hash).toHaveBeenCalledWith('NuevaClave123');
    expect(t.users.setPasswordAndVerifyEmail).toHaveBeenCalledWith('tx', 'u1', 'argon2id:NuevaClave123');
    expect(t.tokensRepo.markUsed).toHaveBeenCalledTimes(1);
    expect(t.sessions.revokeAllActiveOf).toHaveBeenCalledWith('tx', 'u1');
    expect(t.state).toEqual({
      passwordHash: 'argon2id:NuevaClave123',
      emailVerified: true,
      tokenUsed: true,
      sessionsRevoked: true,
    });
    expect(t.log.at(-1)).toBe('commit');
  });

  it('el hash de Argon2 se calcula entre dos transacciones, nunca dentro de la que tiene el bloqueo del token', async () => {
    const t = build();
    await t.service.reset(TOKEN, 'NuevaClave123');

    expect(t.uow.run).toHaveBeenCalledTimes(2);
    const [firstRun, secondRun] = t.uow.run.mock.invocationCallOrder;
    const hashAt = t.hasher.hash.mock.invocationCallOrder[0];
    expect(hashAt).toBeGreaterThan(firstRun);
    expect(hashAt).toBeLessThan(secondRun);
    expect(t.log).toEqual(['commit', 'markUsed', 'password', 'revoke', 'commit']);
  });

  it('si el token se consume entre las dos fases, la segunda falla y no cambia nada', async () => {
    const t = build();
    t.tokensRepo.findByHashForUpdate
      .mockResolvedValueOnce({ id: 't1', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() + 60_000) })
      .mockResolvedValueOnce({ id: 't1', userId: 'u1', usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    expect(await codeOf(t.service.reset(TOKEN, 'NuevaClave123'))).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect(t.tokensRepo.markUsed).not.toHaveBeenCalled();
    expect(t.users.setPasswordAndVerifyEmail).not.toHaveBeenCalled();
    expect(t.sessions.revokeAllActiveOf).not.toHaveBeenCalled();
  });

  it('Escenario 4: token inexistente → INVALID_OR_EXPIRED_TOKEN y no cambia nada', async () => {
    const t = build({ record: null });
    expect(await codeOf(t.service.reset(TOKEN, 'NuevaClave123'))).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect(t.hasher.hash).not.toHaveBeenCalled(); // un token inválido no cuesta un Argon2
    expect(t.users.setPasswordAndVerifyEmail).not.toHaveBeenCalled();
    expect(t.sessions.revokeAllActiveOf).not.toHaveBeenCalled();
  });

  it('Escenario 4: token vencido → INVALID_OR_EXPIRED_TOKEN', async () => {
    const t = build({ record: { id: 't1', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() - 1000) } });
    expect(await codeOf(t.service.reset(TOKEN, 'NuevaClave123'))).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect(t.users.setPasswordAndVerifyEmail).not.toHaveBeenCalled();
  });

  it('Escenario 4: token ya usado → INVALID_OR_EXPIRED_TOKEN (un solo uso)', async () => {
    const t = build({ record: { id: 't1', userId: 'u1', usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } });
    expect(await codeOf(t.service.reset(TOKEN, 'NuevaClave123'))).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect(t.sessions.revokeAllActiveOf).not.toHaveBeenCalled();
  });

  it('una cuenta que ya no está activa no puede restablecerse con un token anterior', async () => {
    const t = build({ user: { ...activeUser, status: UserStatus.LOCKED } });
    expect(await codeOf(t.service.reset(TOKEN, 'NuevaClave123'))).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect(t.tokensRepo.markUsed).not.toHaveBeenCalled();
  });

  it.each(['markUsed', 'revoke'] as const)('si falla %s no cambia contraseña, token ni sesiones (atomicidad)', async (failOn) => {
    const t = build({ failOn });
    await expect(t.service.reset(TOKEN, 'NuevaClave123')).rejects.toThrow();
    expect(t.state).toEqual({ passwordHash: 'hash-viejo', emailVerified: false, tokenUsed: false, sessionsRevoked: false });
    expect(t.log).toContain('rollback');
  });
});

describe('Validación de entrada y rutas (ValidationPipe como en main.ts)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validate = <T>(body: unknown, metatype: new () => T) =>
    pipe.transform(body, { type: 'body', metatype }) as Promise<T>;

  it.each(['corta1', 'sololetrasaaaaa', '123456789012', 'x'.repeat(129) + '1'])(
    'Escenario 5: la contraseña débil %# se rechaza con 400 antes de llegar al servicio (el token no se consume)',
    async (newPassword) => {
      await expect(validate({ token: TOKEN, newPassword }, ResetPasswordDto)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('Escenario 5: la política es la misma que la del registro', async () => {
    const weak = { fullName: 'Ana Pérez', email: 'a@b.co', password: 'sololetrasaaaaa', organizationName: 'Empresa' };
    await expect(validate(weak, RegisterDto)).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ token: TOKEN, newPassword: weak.password }, ResetPasswordDto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('acepta una contraseña que cumple la política y rechaza campos no declarados', async () => {
    const dto = await validate({ token: ` ${TOKEN} `, newPassword: 'NuevaClave123' }, ResetPasswordDto);
    expect(dto.token).toBe(TOKEN); // recortado
    await expect(validate({ token: TOKEN, newPassword: 'NuevaClave123', userId: 'u9' }, ResetPasswordDto))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('forgot-password valida el correo', async () => {
    await expect(validate({ email: 'no-es-correo' }, ForgotPasswordDto)).rejects.toBeInstanceOf(BadRequestException);
    expect((await validate({ email: ' usuario@nexus.com ' }, ForgotPasswordDto)).email).toBe('usuario@nexus.com');
  });

  const controllerWith = (passwordReset: unknown) =>
    new IamController({} as never, {} as never, {} as never, {} as never, passwordReset as never);

  it('Escenarios 1 y 2: forgot-password responde el MISMO mensaje exista o no el correo', async () => {
    const service = { requestReset: jest.fn().mockResolvedValue(undefined) };
    const controller = controllerWith(service);
    const a = await controller.forgotPassword({ email: 'usuario@nexus.com' });
    const b = await controller.forgotPassword({ email: 'noexiste@nexus.com' });
    expect(a).toEqual({ message: GENERIC });
    expect(b).toEqual(a);
  });

  it('Escenario 3: reset-password responde el mensaje del contrato', async () => {
    const service = { reset: jest.fn().mockResolvedValue(undefined) };
    const result = await controllerWith(service).resetPassword({ token: TOKEN, newPassword: 'NuevaClave123' });
    expect(service.reset).toHaveBeenCalledWith(TOKEN, 'NuevaClave123');
    expect(result).toEqual({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  });
});
