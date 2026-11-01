import { HttpException } from '@nestjs/common';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { Role, UserStatus } from './domain/enums';
import { AuthService } from './services/auth.service';
import { SessionService } from './services/session.service';

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (err) {
    return (err as HttpException).getResponse()['code'] as string;
  }
  return 'NO_ERROR';
};

describe('AuthService.authenticate (sin base de datos: puertos simulados)', () => {
  const build = (userOverrides: Record<string, unknown> = {}, requireVerified = true) => {
    const user = {
      id: 'u1',
      email: 'ana@test.com',
      fullName: 'Ana',
      passwordHash: 'hash:Password123',
      mfaEnabled: false,
      emailVerified: true,
      status: UserStatus.ACTIVE,
      ...userOverrides,
    };
    const membership = {
      userId: 'u1',
      organizationId: 'o1',
      role: Role.TENANT_ADMIN,
      organization: { id: 'o1', name: 'Org' },
    };
    const users = { findByEmail: jest.fn().mockResolvedValue(user) };
    const memberships = { findActive: jest.fn().mockResolvedValue(membership) };
    const hasher = {
      hash: jest.fn(async (p: string) => `hash:${p}`),
      verify: jest.fn(async (h: string, p: string) => h === `hash:${p}`),
    };
    const sessionResult = {
      accessToken: 'jwt',
      user: { id: user.id, fullName: user.fullName, email: user.email },
      organization: membership.organization,
    };
    const sessions = { open: jest.fn().mockResolvedValue(sessionResult) };
    const uow = { run: jest.fn((work: (tx: unknown) => unknown) => work('tx')) };
    const audit = { logEvent: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(
      users as never,
      memberships as never,
      hasher as never,
      sessions as never,
      { verify: jest.fn() } as never,
      uow as never,
      { requireVerifiedEmail: requireVerified } as never,
      audit as never,
    );
    return { service, users, memberships, hasher, sessions, uow, audit, user, membership };
  };

  it('correo inexistente: verifica contra el hash señuelo y responde INVALID_CREDENTIALS', async () => {
    const t = build();
    await t.service.onModuleInit();
    t.users.findByEmail.mockResolvedValue(null);
    expect(await codeOf(t.service.authenticate('nadie@test.com', 'Password123'))).toBe('INVALID_CREDENTIALS');
    expect(t.hasher.verify).toHaveBeenCalledTimes(1); // igualó el tiempo de respuesta
    expect(t.sessions.open).not.toHaveBeenCalled();
  });

  it('contraseña incorrecta: mismo código que correo inexistente', async () => {
    const t = build();
    await t.service.onModuleInit();
    expect(await codeOf(t.service.authenticate('ana@test.com', 'Incorrecta1'))).toBe('INVALID_CREDENTIALS');
  });

  it.each([UserStatus.INACTIVE, UserStatus.LOCKED])(
    'cuenta %s con contraseña correcta: INVALID_CREDENTIALS (no revela el estado)',
    async (status: UserStatus) => {
      const t = build({ status });
      await t.service.onModuleInit();
      expect(await codeOf(t.service.authenticate('ana@test.com', 'Password123'))).toBe('INVALID_CREDENTIALS');
      expect(t.sessions.open).not.toHaveBeenCalled();
    },
  );

  it('mfaEnabled=true falla cerrado (MFA/TOTP fuera de alcance)', async () => {
    const t = build({ mfaEnabled: true });
    await t.service.onModuleInit();
    expect(await codeOf(t.service.authenticate('ana@test.com', 'Password123'))).toBe('MFA_NOT_SUPPORTED');
    expect(t.sessions.open).not.toHaveBeenCalled();
  });

  it('correo sin verificar: EMAIL_NOT_VERIFIED solo tras contraseña correcta; configurable', async () => {
    const strict = build({ emailVerified: false }, true);
    await strict.service.onModuleInit();
    expect(await codeOf(strict.service.authenticate('ana@test.com', 'Password123'))).toBe('EMAIL_NOT_VERIFIED');
    expect(await codeOf(strict.service.authenticate('ana@test.com', 'Incorrecta1'))).toBe('INVALID_CREDENTIALS');

    const lenient = build({ emailVerified: false }, false);
    await lenient.service.onModuleInit();
    expect(await codeOf(lenient.service.authenticate('ana@test.com', 'Password123'))).toBe('NO_ERROR');
  });

  it('sin membresía activa: NO_ACTIVE_MEMBERSHIP', async () => {
    const t = build();
    await t.service.onModuleInit();
    t.memberships.findActive.mockResolvedValue(null);
    expect(await codeOf(t.service.authenticate('ana@test.com', 'Password123'))).toBe('NO_ACTIVE_MEMBERSHIP');
  });

  it('éxito: abre la sesión dentro de una transacción', async () => {
    const t = build();
    await t.service.onModuleInit();
    await t.service.authenticate('ANA@test.com ', 'Password123');
    expect(t.users.findByEmail).toHaveBeenCalledWith('ana@test.com'); // correo normalizado
    expect(t.sessions.open).toHaveBeenCalledWith('tx', t.user, t.membership);
  });

  describe('SPEC-405: AUTH_LOGIN', () => {
    it('Escenario 1: tras abrir la sesión registra AUTH_LOGIN con la organización y el usuario del resultado', async () => {
      const t = build();
      await t.service.onModuleInit();
      await t.service.authenticate('ana@test.com', 'Password123');
      expect(t.audit.logEvent).toHaveBeenCalledTimes(1);
      expect(t.audit.logEvent).toHaveBeenCalledWith({
        organizationId: 'o1',
        actorId: 'u1',
        action: AuditAction.AUTH_LOGIN,
        resourceType: AuditResource.USER,
        resourceId: 'u1',
      });
    });

    it('Escenario 2: contraseña incorrecta o sin membresía activa no registra evento', async () => {
      const wrongPassword = build();
      await wrongPassword.service.onModuleInit();
      await codeOf(wrongPassword.service.authenticate('ana@test.com', 'Incorrecta1'));
      expect(wrongPassword.audit.logEvent).not.toHaveBeenCalled();

      const noMembership = build();
      await noMembership.service.onModuleInit();
      noMembership.memberships.findActive.mockResolvedValue(null);
      await codeOf(noMembership.service.authenticate('ana@test.com', 'Password123'));
      expect(noMembership.audit.logEvent).not.toHaveBeenCalled();
    });

    it('Escenario 3: si logEvent falla, el login responde igual que sin auditoría', async () => {
      const t = build();
      await t.service.onModuleInit();
      t.audit.logEvent.mockRejectedValueOnce(new Error('Audit DB down'));
      await expect(t.service.authenticate('ana@test.com', 'Password123')).resolves.toMatchObject({
        accessToken: 'jwt',
      });
    });

    it('Escenario 4: el evento se registra después de confirmar la transacción', async () => {
      const t = build();
      await t.service.onModuleInit();
      const order: string[] = [];
      t.uow.run.mockImplementationOnce(async (work: (tx: unknown) => Promise<unknown>) => {
        const result = await work('tx');
        order.push('commit');
        return result;
      });
      t.audit.logEvent.mockImplementationOnce(async () => void order.push('audit'));
      await t.service.authenticate('ana@test.com', 'Password123');
      expect(order).toEqual(['commit', 'audit']);
    });
  });
});

describe('SessionService.refresh', () => {
  const build = (session: Record<string, unknown> | null) => {
    const repo = {
      findByRefreshHashForUpdate: jest.fn().mockResolvedValue(session),
      revoke: jest.fn(),
      revokeAllActiveOf: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 's2' }),
    };
    const users = {
      findById: jest.fn().mockResolvedValue({
        id: 'u1',
        fullName: 'Ana',
        email: 'a@t.com',
        mfaEnabled: false,
        emailVerified: true,
        status: UserStatus.ACTIVE,
      }),
    };
    const memberships = {
      findActive: jest.fn().mockResolvedValue({
        organizationId: 'o1',
        role: Role.TENANT_ADMIN,
        organization: { id: 'o1', name: 'Org' },
      }),
    };
    const uow = { run: jest.fn((work: (tx: unknown) => unknown) => work('tx')) };
    const access = { issue: jest.fn().mockResolvedValue({ token: 'jwt2', expiresAt: '2026-01-01T00:00:00.000Z' }) };
    const opaque = { generate: jest.fn().mockReturnValue('raw2'), hash: jest.fn((t: string) => `h(${t})`) };
    const service = new SessionService(
      repo as never,
      users as never,
      memberships as never,
      uow as never,
      access as never,
      opaque as never,
      { requireVerifiedEmail: true } as never,
    );
    return { service, repo, memberships, users };
  };

  const live = (extra: Record<string, unknown> = {}) => ({
    id: 's1',
    userId: 'u1',
    isRevoked: () => false,
    isExpired: () => false,
    ...extra,
  });

  it('sin cookie o token desconocido: INVALID_SESSION', async () => {
    expect(await codeOf(build(null).service.refresh(undefined))).toBe('INVALID_SESSION');
    expect(await codeOf(build(null).service.refresh('x'))).toBe('INVALID_SESSION');
  });

  it('reutilizar un token revocado revoca todas las sesiones del usuario', async () => {
    const t = build(live({ isRevoked: () => true }));
    expect(await codeOf(t.service.refresh('viejo'))).toBe('INVALID_SESSION');
    expect(t.repo.revokeAllActiveOf).toHaveBeenCalledWith('tx', 'u1');
    expect(t.repo.create).not.toHaveBeenCalled();
  });

  it('token vencido: INVALID_SESSION', async () => {
    const t = build(live({ isExpired: () => true }));
    expect(await codeOf(t.service.refresh('x'))).toBe('INVALID_SESSION');
  });

  it('token válido: revoca el usado, vuelve a derivar la organización y abre una sesión nueva', async () => {
    const t = build(live());
    const result = await t.service.refresh('x');
    expect(t.repo.revoke).toHaveBeenCalled();
    expect(t.memberships.findActive).toHaveBeenCalledWith('u1', undefined, 'tx'); // iam.session no guarda la organización
    expect(t.repo.create).toHaveBeenCalledWith('tx', expect.objectContaining({ userId: 'u1', refreshTokenHash: 'h(raw2)' }));
    expect(result.refreshToken).toBe('raw2');
    expect(result.role).toBe(Role.TENANT_ADMIN);
  });

  it('usuario bloqueado: la sesión se revoca y no se emite otra', async () => {
    const t = build(live());
    t.users.findById.mockResolvedValue({ id: 'u1', status: UserStatus.LOCKED, emailVerified: true, mfaEnabled: false });
    expect(await codeOf(t.service.refresh('x'))).toBe('INVALID_SESSION');
    expect(t.repo.revoke).toHaveBeenCalled();
    expect(t.repo.create).not.toHaveBeenCalled();
  });
});
