import { HttpException } from '@nestjs/common';
import { AuditAction, AuditResource } from '../../audit/audit.types';
import { Role, UserStatus } from '../domain/enums';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { AuthUser } from '../interfaces/auth-user.interface';
import { AccountService } from './account.service';

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (err) {
    return ((err as HttpException).getResponse() as { code: string }).code;
  }
  return 'NO_ERROR';
};

const actor: AuthUser = {
  userId: 'u1',
  organizationId: 'o1',
  role: Role.TENANT_ADMIN,
  email: 'ana@nexus.com',
  fullName: 'Ana',
  organizationName: 'Empresa',
  isSuperAdmin: false,
};

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  status: UserStatus;
  lockedUntil: Date | null;
}

const activeUser: UserRow = {
  id: 'u1',
  email: 'ana@nexus.com',
  fullName: 'Ana',
  passwordHash: 'hash-actual',
  status: UserStatus.ACTIVE,
  lockedUntil: null,
};

interface Options {
  /** Fila que devuelve findById. null = la cuenta no existe. */
  user?: UserRow | null;
  /** Resultado de verificar la contraseña actual. */
  passwordMatches?: boolean;
  /** Fila que devuelve findByIdForUpdate dentro de la transacción. Por defecto, la fila actual. */
  lockedRow?: UserRow | null;
  failOn?: 'setPassword' | 'revoke';
}

/** Orden de las operaciones y estado simulado con rollback, para probar atomicidad y secuencia. */
const build = (opts: Options = {}) => {
  const log: string[] = [];
  const state = { passwordHash: 'hash-actual', sessionsRevoked: false, failedLogins: 0 };
  const user = opts.user === undefined ? activeUser : opts.user;

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
    findById: jest.fn().mockResolvedValue(user),
    findByIdForUpdate: jest.fn(async () => {
      log.push('lock');
      if (opts.lockedRow !== undefined) return opts.lockedRow;
      return user ? { ...user, passwordHash: state.passwordHash } : null;
    }),
    updateFullName: jest.fn(async () => void log.push('name')),
    setPassword: jest.fn(async (_tx: unknown, _id: string, hash: string) => {
      if (opts.failOn === 'setPassword') throw new Error('falla');
      state.passwordHash = hash;
      log.push('password');
    }),
    clearFailedLogins: jest.fn(async () => void log.push('clear')),
    // Fuera de cualquier transacción: el fallo debe quedar guardado aunque la petición termine con error.
    registerFailedLogin: jest.fn(async () => {
      state.failedLogins += 1;
      log.push('failed');
    }),
  };
  const sessions = {
    revokeAllActiveOf: jest.fn(async () => {
      if (opts.failOn === 'revoke') throw new Error('falla');
      state.sessionsRevoked = true;
      log.push('revoke');
    }),
  };
  const hasher = {
    verify: jest.fn(async () => opts.passwordMatches ?? true),
    hash: jest.fn(async (plain: string) => `argon2id:${plain}`),
  };
  const audit = { logEvent: jest.fn(async () => void log.push('audit')) };

  const service = new AccountService(
    uow as never,
    users as never,
    sessions as never,
    hasher as never,
    audit as never,
  );
  return { service, log, state, uow, users, sessions, hasher, audit };
};

const passwords = (currentPassword: string, newPassword: string): ChangePasswordDto => ({
  currentPassword,
  newPassword,
});

describe('AccountService.updateProfile (SPEC-113 escenario 1)', () => {
  it('guarda el nombre con el userId del actor y devuelve el valor guardado', async () => {
    const t = build();
    await expect(t.service.updateProfile(actor, 'Ana Pérez')).resolves.toBe('Ana Pérez');
    expect(t.uow.run).toHaveBeenCalledTimes(1);
    expect(t.users.updateFullName).toHaveBeenCalledWith('tx', 'u1', 'Ana Pérez');
  });

  it('no toca la contraseña, las sesiones ni la auditoría (el cambio de nombre no se audita)', async () => {
    const t = build();
    await t.service.updateProfile(actor, 'Ana Pérez');
    expect(t.users.setPassword).not.toHaveBeenCalled();
    expect(t.sessions.revokeAllActiveOf).not.toHaveBeenCalled();
    expect(t.audit.logEvent).not.toHaveBeenCalled();
  });
});

describe('AccountService.changePassword: escenario 2 (cambio correcto)', () => {
  it('cambia la contraseña, revoca todas las sesiones y limpia intentos fallidos, en una sola transacción', async () => {
    const t = build();
    await expect(t.service.changePassword(actor, passwords('ActualClave1', 'NuevaClave123'))).resolves.toBeUndefined();

    expect(t.users.findById).toHaveBeenCalledWith('u1');
    expect(t.hasher.verify).toHaveBeenCalledWith('hash-actual', 'ActualClave1');
    expect(t.users.setPassword).toHaveBeenCalledWith('tx', 'u1', 'argon2id:NuevaClave123');
    expect(t.sessions.revokeAllActiveOf).toHaveBeenCalledWith('tx', 'u1');
    expect(t.users.clearFailedLogins).toHaveBeenCalledWith('u1', 'tx');
    expect(t.uow.run).toHaveBeenCalledTimes(1);
    expect(t.state).toEqual({ passwordHash: 'argon2id:NuevaClave123', sessionsRevoked: true, failedLogins: 0 });
  });

  it('calcula el hash nuevo antes de abrir la transacción, para no retener el bloqueo de fila mientras hashea', async () => {
    const t = build();
    await t.service.changePassword(actor, passwords('ActualClave1', 'NuevaClave123'));
    const hashAt = t.hasher.hash.mock.invocationCallOrder[0];
    const txAt = t.uow.run.mock.invocationCallOrder[0];
    expect(hashAt).toBeLessThan(txAt);
  });

  it('registra AUTH_PASSWORD_CHANGED después del commit, con la organización del actor', async () => {
    const t = build();
    await t.service.changePassword(actor, passwords('ActualClave1', 'NuevaClave123'));
    expect(t.audit.logEvent).toHaveBeenCalledTimes(1);
    expect(t.audit.logEvent).toHaveBeenCalledWith({
      organizationId: 'o1',
      actorId: 'u1',
      action: AuditAction.AUTH_PASSWORD_CHANGED,
      resourceType: AuditResource.USER,
      resourceId: 'u1',
    });
    expect(t.log).toEqual(['lock', 'password', 'revoke', 'clear', 'commit', 'audit']);
  });

  it('si la auditoría falla, el cambio ya está confirmado y la respuesta es exitosa', async () => {
    const t = build();
    t.audit.logEvent.mockRejectedValueOnce(new Error('Audit DB down'));
    await expect(t.service.changePassword(actor, passwords('ActualClave1', 'NuevaClave123'))).resolves.toBeUndefined();
    expect(t.state.passwordHash).toBe('argon2id:NuevaClave123');
  });

  it.each(['setPassword', 'revoke'] as const)(
    'si falla %s, la contraseña, las sesiones y el contador no cambian (atomicidad)',
    async (failOn) => {
      const t = build({ failOn });
      await expect(t.service.changePassword(actor, passwords('ActualClave1', 'NuevaClave123'))).rejects.toThrow();
      expect(t.state).toEqual({ passwordHash: 'hash-actual', sessionsRevoked: false, failedLogins: 0 });
      expect(t.log).toContain('rollback');
      expect(t.audit.logEvent).not.toHaveBeenCalled();
    },
  );
});

describe('AccountService.changePassword: escenario 3 (contraseña actual incorrecta)', () => {
  it('responde INVALID_CREDENTIALS, registra el fallo fuera de una transacción y no escribe nada más', async () => {
    const t = build({ passwordMatches: false });
    expect(await codeOf(t.service.changePassword(actor, passwords('Mala1234', 'NuevaClave123')))).toBe(
      'INVALID_CREDENTIALS',
    );
    expect(t.users.registerFailedLogin).toHaveBeenCalledTimes(1);
    expect(t.users.registerFailedLogin).toHaveBeenCalledWith('u1', expect.any(Date));
    expect(t.uow.run).not.toHaveBeenCalled();
    expect(t.hasher.hash).not.toHaveBeenCalled(); // una contraseña actual incorrecta no cuesta un Argon2 de la nueva
    expect(t.users.setPassword).not.toHaveBeenCalled();
    expect(t.sessions.revokeAllActiveOf).not.toHaveBeenCalled();
    expect(t.audit.logEvent).not.toHaveBeenCalled();
    expect(t.state).toEqual({ passwordHash: 'hash-actual', sessionsRevoked: false, failedLogins: 1 });
  });
});

describe('AccountService.changePassword: cuenta bloqueada (SPEC-112)', () => {
  const locked = { ...activeUser, lockedUntil: new Date(Date.now() + 60_000) };

  it.each([true, false])(
    'con bloqueo vigente responde INVALID_CREDENTIALS sin escribir ni contar el intento (contraseña correcta: %s)',
    async (passwordMatches) => {
      const t = build({ user: locked, passwordMatches });
      expect(await codeOf(t.service.changePassword(actor, passwords('ActualClave1', 'NuevaClave123')))).toBe(
        'INVALID_CREDENTIALS',
      );
      expect(t.hasher.verify).toHaveBeenCalledTimes(1); // igual que el login: el hash se verifica siempre
      expect(t.users.registerFailedLogin).not.toHaveBeenCalled(); // el intento no alarga el bloqueo
      expect(t.uow.run).not.toHaveBeenCalled();
      expect(t.users.setPassword).not.toHaveBeenCalled();
      expect(t.state).toEqual({ passwordHash: 'hash-actual', sessionsRevoked: false, failedLogins: 0 });
    },
  );

  it('un bloqueo ya vencido no impide el cambio', async () => {
    const t = build({ user: { ...activeUser, lockedUntil: new Date(Date.now() - 1000) } });
    await expect(t.service.changePassword(actor, passwords('ActualClave1', 'NuevaClave123'))).resolves.toBeUndefined();
    expect(t.state.passwordHash).toBe('argon2id:NuevaClave123');
  });
});

describe('AccountService.changePassword: robustez', () => {
  it('bloqueo puesto por otra petición mientras se hasheaba: dentro de la transacción no escribe nada', async () => {
    const t = build({ lockedRow: { ...activeUser, lockedUntil: new Date(Date.now() + 60_000) } });
    expect(await codeOf(t.service.changePassword(actor, passwords('ActualClave1', 'NuevaClave123')))).toBe(
      'INVALID_CREDENTIALS',
    );
    expect(t.users.setPassword).not.toHaveBeenCalled();
    expect(t.sessions.revokeAllActiveOf).not.toHaveBeenCalled();
    expect(t.users.clearFailedLogins).not.toHaveBeenCalled();
    expect(t.log).toEqual(['lock', 'rollback']);
  });

  it('cambio concurrente: si el hash cambió dentro de la transacción, no escribe nada', async () => {
    const t = build({ lockedRow: { ...activeUser, passwordHash: 'hash-otro' } });
    expect(await codeOf(t.service.changePassword(actor, passwords('ActualClave1', 'NuevaClave123')))).toBe(
      'INVALID_CREDENTIALS',
    );
    expect(t.users.setPassword).not.toHaveBeenCalled();
    expect(t.sessions.revokeAllActiveOf).not.toHaveBeenCalled();
    expect(t.users.clearFailedLogins).not.toHaveBeenCalled();
    expect(t.audit.logEvent).not.toHaveBeenCalled();
    expect(t.log).toEqual(['lock', 'rollback']);
  });

  it.each([UserStatus.INACTIVE, UserStatus.LOCKED])(
    'cuenta %s: responde UNAUTHORIZED sin escrituras ni intentos contados',
    async (status) => {
      const t = build({ user: { ...activeUser, status } });
      expect(await codeOf(t.service.changePassword(actor, passwords('ActualClave1', 'NuevaClave123')))).toBe(
        'UNAUTHORIZED',
      );
      expect(t.users.registerFailedLogin).not.toHaveBeenCalled();
      expect(t.uow.run).not.toHaveBeenCalled();
      expect(t.users.setPassword).not.toHaveBeenCalled();
      expect(t.audit.logEvent).not.toHaveBeenCalled();
    },
  );

  it('cuenta inexistente: responde UNAUTHORIZED', async () => {
    const t = build({ user: null });
    expect(await codeOf(t.service.changePassword(actor, passwords('ActualClave1', 'NuevaClave123')))).toBe(
      'UNAUTHORIZED',
    );
    expect(t.uow.run).not.toHaveBeenCalled();
  });
});
