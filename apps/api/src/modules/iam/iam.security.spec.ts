import { HttpException } from '@nestjs/common';
import { MembershipStatus, OrgStatus, Role, TokenPurpose, UserStatus } from './domain/enums';
import {
  LOCKOUT_BASE_SECONDS,
  LOCKOUT_MAX_SECONDS,
  LOCKOUT_THRESHOLD,
  TypeOrmMembershipRepository,
  TypeOrmUserRepository,
} from './infrastructure/typeorm-repositories';
import { AuthService } from './services/auth.service';
import { EmailVerificationService } from './services/email-verification.service';
import { VerificationTokenService } from './services/verification-token.service';
import { JwtStrategy } from './strategies/jwt.strategy';

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (err) {
    return (err as HttpException).getResponse()['code'] as string;
  }
  return 'NO_ERROR';
};

describe('JwtStrategy.validate (contexto autenticado derivado del servidor)', () => {
  const build = (membership: unknown) => {
    const memberships = { findActive: jest.fn().mockResolvedValue(membership) };
    const config = { getOrThrow: jest.fn().mockReturnValue('x'.repeat(32)) };
    return { strategy: new JwtStrategy(config as never, memberships as never), memberships };
  };
  const membership = {
    userId: 'u1',
    organizationId: 'o1',
    role: Role.TENANT_ADMIN,
    user: { email: 'ana@test.com', fullName: 'Ana' },
    organization: { name: 'Empresa SA' },
  };

  it('token sin sub u org: UNAUTHORIZED y ni siquiera consulta la base', async () => {
    const t = build(membership);
    expect(await codeOf(t.strategy.validate({ sub: '', org: 'o1', role: 'x' }))).toBe('UNAUTHORIZED');
    expect(await codeOf(t.strategy.validate({ sub: 'u1', org: '', role: 'x' }))).toBe('UNAUTHORIZED');
    expect(t.memberships.findActive).not.toHaveBeenCalled();
  });

  it('sin membresía activa (usuario, organización o membresía suspendidos): UNAUTHORIZED', async () => {
    const t = build(null);
    expect(await codeOf(t.strategy.validate({ sub: 'u1', org: 'o1', role: 'tenant_admin' }))).toBe('UNAUTHORIZED');
  });

  it('el rol sale de la membresía en la base, no del claim del token', async () => {
    const t = build({ ...membership, role: Role.COLABORADOR });
    const user = await t.strategy.validate({ sub: 'u1', org: 'o1', role: 'tenant_admin' }); // el claim miente
    expect(user.role).toBe(Role.COLABORADOR);
  });

  it('revalida usuario y organización del claim en cada request y arma el contexto desde la BD', async () => {
    const t = build(membership);
    const user = await t.strategy.validate({ sub: 'u1', org: 'o1', role: 'tenant_admin' });
    expect(t.memberships.findActive).toHaveBeenCalledWith('u1', 'o1');
    expect(user).toEqual({
      userId: 'u1',
      organizationId: 'o1',
      role: Role.TENANT_ADMIN,
      email: 'ana@test.com',
      fullName: 'Ana',
      organizationName: 'Empresa SA',
      isSuperAdmin: false,
    });
  });
});

describe('SPEC-501: isSuperAdmin en JwtStrategy.validate (siempre de la base)', () => {
  const buildWith = (isSuperAdmin: unknown) => {
    const membership = {
      userId: 'u1',
      organizationId: 'o1',
      role: Role.TENANT_ADMIN,
      user: { email: 'ana@test.com', fullName: 'Ana', isSuperAdmin },
      organization: { name: 'Empresa SA' },
    };
    const memberships = { findActive: jest.fn().mockResolvedValue(membership) };
    const config = { getOrThrow: jest.fn().mockReturnValue('x'.repeat(32)) };
    return new JwtStrategy(config as never, memberships as never);
  };

  it('Escenario 1: true en la base → isSuperAdmin: true; false → false', async () => {
    expect((await buildWith(true).validate({ sub: 'u1', org: 'o1', role: 'tenant_admin' })).isSuperAdmin).toBe(true);
    expect((await buildWith(false).validate({ sub: 'u1', org: 'o1', role: 'tenant_admin' })).isSuperAdmin).toBe(false);
  });

  it('Escenario 2: un isSuperAdmin alterado en el JWT no tiene efecto (se lee de la base)', async () => {
    const forged = { sub: 'u1', org: 'o1', role: 'tenant_admin', isSuperAdmin: true } as never;
    expect((await buildWith(false).validate(forged)).isSuperAdmin).toBe(false);
    const revoked = { sub: 'u1', org: 'o1', role: 'tenant_admin', isSuperAdmin: false } as never;
    expect((await buildWith(true).validate(revoked)).isSuperAdmin).toBe(true); // lo que dice la base manda en ambos sentidos
  });

  it('un valor que no es exactamente true (null, undefined, "true") se trata como false', async () => {
    for (const value of [undefined, null, 'true', 1]) {
      expect((await buildWith(value).validate({ sub: 'u1', org: 'o1', role: 'x' })).isSuperAdmin).toBe(false);
    }
  });
});

describe('TypeOrmMembershipRepository (con EntityManager simulado, sin base de datos)', () => {
  const fakeManager = () => ({
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    save: jest.fn(async (x: unknown) => x),
  });
  const buildRepo = (manager = fakeManager()) => ({
    manager,
    repo: new TypeOrmMembershipRepository({ manager } as never),
  });

  it('findActive exige membresía, usuario y organización en estado "active" (valores del ENUM real)', async () => {
    const { repo, manager } = buildRepo();
    await repo.findActive('u1', 'o1');

    const call = (manager.findOne as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const opts = call[1] as { where: Record<string, unknown>; relations: unknown; order: unknown };
    expect(opts.where).toEqual({
      userId: 'u1',
      status: MembershipStatus.ACTIVE,
      user: { status: UserStatus.ACTIVE },
      organization: { status: OrgStatus.ACTIVE },
      organizationId: 'o1',
    });
    expect(MembershipStatus.ACTIVE).toBe('active');
    expect(UserStatus.ACTIVE).toBe('active');
    expect(OrgStatus.ACTIVE).toBe('active');
    expect(opts.relations).toEqual({ user: true, organization: true, roleRef: true });
    expect(opts.order).toEqual({ createdAt: 'ASC' });
  });

  it('sin organizationId no filtra por organización (el login toma la membresía activa más antigua)', async () => {
    const { repo, manager } = buildRepo();
    await repo.findActive('u1');
    const opts = (manager.findOne as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as {
      where: Record<string, unknown>;
    };
    expect('organizationId' in opts.where).toBe(false);
  });

  it('dentro de una transacción usa la transacción, no el manager por defecto', async () => {
    const { repo, manager } = buildRepo();
    const tx = fakeManager();
    await repo.findActive('u1', undefined, tx as never);
    expect(tx.findOne).toHaveBeenCalledTimes(1);
    expect(manager.findOne).not.toHaveBeenCalled();
  });

  it('create: si el rol no existe en iam.role falla con un mensaje claro y NO guarda la membresía', async () => {
    const { repo } = buildRepo();
    const tx = fakeManager(); // findOne → null: catálogo sin el rol
    let message = '';
    try {
      await repo.create(tx as never, { userId: 'u1', organizationId: 'o1', role: Role.TENANT_ADMIN });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('iam.role');
    expect(message).toContain('tenant_admin');
    expect(tx.save).not.toHaveBeenCalled();
  });

  it('create: con el rol en el catálogo guarda role_id y estado active', async () => {
    const { repo } = buildRepo();
    const tx = fakeManager();
    tx.findOne.mockResolvedValue({ id: 1, name: 'tenant_admin' });
    await repo.create(tx as never, { userId: 'u1', organizationId: 'o1', role: Role.TENANT_ADMIN });
    expect(tx.create).toHaveBeenCalledWith(
      expect.any(Function),
      { userId: 'u1', organizationId: 'o1', roleId: 1, status: MembershipStatus.ACTIVE },
    );
    expect(tx.save).toHaveBeenCalledTimes(1);
  });
});

describe('EmailVerificationService (token de un solo uso, 15 minutos, propósito email_verification)', () => {
  const build = (record: unknown) => {
    const tokensRepo = {
      findByHashForUpdate: jest.fn().mockResolvedValue(record),
      markUsed: jest.fn(),
      create: jest.fn(),
    };
    const users = { markEmailVerified: jest.fn() };
    const opaque = { hash: jest.fn((t: string) => `h(${t})`), generate: jest.fn().mockReturnValue('raw') };
    const uow = { run: jest.fn((work: (tx: unknown) => unknown) => work('tx')) };
    const outbox = { enqueue: jest.fn().mockResolvedValue('out-1') };
    // VerificationTokenService real: emitir el token es parte del comportamiento que se verifica aquí.
    const tokens = new VerificationTokenService(tokensRepo as never, opaque as never);
    const service = new EmailVerificationService(
      uow as never,
      tokensRepo as never,
      users as never,
      opaque as never,
      tokens,
      outbox as never,
    );
    return { service, tokensRepo, users, outbox };
  };
  const MIN = 60_000;

  it('token válido: lo marca usado y verifica el correo en la misma transacción', async () => {
    const t = build({ id: 't1', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() + 5 * MIN) });
    await t.service.verify('tok');
    expect(t.tokensRepo.findByHashForUpdate).toHaveBeenCalledWith('tx', 'h(tok)', TokenPurpose.EMAIL_VERIFICATION);
    expect(t.tokensRepo.markUsed).toHaveBeenCalledTimes(1);
    expect(t.users.markEmailVerified).toHaveBeenCalledWith('tx', 'u1');
  });

  it.each(['desconocido', 'ya usado', 'vencido'])('token %s: INVALID_VERIFICATION_TOKEN y no verifica nada', async (caso: string) => {
    const records: Record<string, unknown> = {
      desconocido: null,
      'ya usado': { id: 't1', userId: 'u1', usedAt: new Date(), expiresAt: new Date(Date.now() + 5 * MIN) },
      vencido: { id: 't1', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() - MIN) },
    };
    const t = build(records[caso]);
    expect(await codeOf(t.service.verify('tok'))).toBe('INVALID_VERIFICATION_TOKEN');
    expect(t.tokensRepo.markUsed).not.toHaveBeenCalled();
    expect(t.users.markEmailVerified).not.toHaveBeenCalled();
  });

  it('un token de otro propósito (p. ej. restablecer contraseña) no puede verificar un correo: la búsqueda siempre filtra por propósito', async () => {
    const t = build(null); // el repositorio no encuentra tokens con ese hash y propósito email_verification
    expect(await codeOf(t.service.verify('token-de-password-reset'))).toBe('INVALID_VERIFICATION_TOKEN');
    const call = (t.tokensRepo.findByHashForUpdate as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[2]).toBe('email_verification');
    expect(call[2]).not.toBe(TokenPurpose.PASSWORD_RESET);
  });

  it('issue: guarda solo el hash, con propósito email_verification y vencimiento de 15 minutos', async () => {
    const t = build(null);
    await t.service.issue('tx' as never, { id: 'u1', email: 'ana@test.com', fullName: 'Ana' });
    const data = (t.tokensRepo.create as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as {
      tokenHash: string;
      purpose: string;
      expiresAt: Date;
    };
    expect(t.outbox.enqueue).toHaveBeenCalledWith('tx', expect.objectContaining({ rawToken: 'raw' }));
    expect(data.tokenHash).toBe('h(raw)');
    expect(data.tokenHash).not.toBe('raw');
    expect(data.purpose).toBe('email_verification');
    const ms = data.expiresAt.getTime() - Date.now();
    expect(ms > 14 * MIN && ms <= 15 * MIN).toBe(true);
  });
});

// La renovación de sesión con varias organizaciones se verifica en iam.session.spec.ts:
// iam.session ya guarda organization_id y refresh la conserva y revalida.

describe('SPEC-112: bloqueo progresivo en AuthService.authenticate', () => {
  const FUTURE = new Date(Date.now() + 60_000);
  const PAST = new Date(Date.now() - 60_000);

  const build = (userOverrides: Record<string, unknown> = {}) => {
    const log: string[] = [];
    const user = {
      id: 'u1',
      email: 'ana@test.com',
      fullName: 'Ana',
      passwordHash: 'hash:Password123',
      mfaEnabled: false,
      emailVerified: true,
      status: UserStatus.ACTIVE,
      failedLoginAttempts: 0,
      lockedUntil: null as Date | null,
      ...userOverrides,
    };
    const membership = { userId: 'u1', organizationId: 'o1', role: Role.TENANT_ADMIN, organization: { id: 'o1', name: 'Org' } };
    const users = {
      findByEmail: jest.fn().mockResolvedValue(user),
      registerFailedLogin: jest.fn(async () => void log.push('fail')),
      clearFailedLogins: jest.fn(async () => void log.push('clear')),
    };
    const hasher = {
      hash: jest.fn(async (p: string) => `hash:${p}`),
      verify: jest.fn(async (h: string, p: string) => h === `hash:${p}`),
    };
    const sessions = {
      open: jest.fn(async () => (log.push('open'), { accessToken: 'jwt', user: { id: 'u1' }, organization: membership.organization })),
    };
    const uow = { run: jest.fn((work: (tx: unknown) => unknown) => work('tx')) };
    const service = new AuthService(
      users as never,
      { findActive: jest.fn().mockResolvedValue(membership) } as never,
      hasher as never,
      sessions as never,
      { verify: jest.fn() } as never,
      uow as never,
      { requireVerifiedEmail: true } as never,
      { logEvent: jest.fn().mockResolvedValue(undefined) } as never,
    );
    return { service, users, hasher, sessions, log, user };
  };
  const login = async (t: ReturnType<typeof build>, password: string) => {
    await t.service.onModuleInit();
    return codeOf(t.service.authenticate('ana@test.com', password));
  };

  it('Escenario 1: contraseña incorrecta → registra el fallo del usuario y responde 401 INVALID_CREDENTIALS', async () => {
    const t = build();
    expect(await login(t, 'Incorrecta1')).toBe('INVALID_CREDENTIALS');
    expect(t.users.registerFailedLogin).toHaveBeenCalledTimes(1);
    expect(t.users.registerFailedLogin).toHaveBeenCalledWith('u1', expect.any(Date));
    expect(t.users.clearFailedLogins).not.toHaveBeenCalled();
    expect(t.sessions.open).not.toHaveBeenCalled();
  });

  it('Escenario 1: el fallo se registra fuera de la transacción (no depende de que se revierta)', async () => {
    const t = build();
    await login(t, 'Incorrecta1');
    expect(t.users.registerFailedLogin).toHaveBeenCalledWith('u1', expect.any(Date)); // sin tx
    expect(t.users.registerFailedLogin.mock.calls[0]).toHaveLength(2);
  });

  it('Escenario 2: tras vencer el bloqueo, un nuevo fallo vuelve a contarse', async () => {
    const t = build({ failedLoginAttempts: 5, lockedUntil: PAST });
    expect(await login(t, 'Incorrecta1')).toBe('INVALID_CREDENTIALS');
    expect(t.users.registerFailedLogin).toHaveBeenCalledTimes(1);
  });

  it('Escenario 2: tras vencer el bloqueo, la contraseña correcta inicia sesión', async () => {
    const t = build({ failedLoginAttempts: 5, lockedUntil: PAST });
    expect(await login(t, 'Password123')).toBe('NO_ERROR');
  });

  it('Escenario 3: contraseña correcta durante el bloqueo → INVALID_CREDENTIALS, sin sesión y sin contar', async () => {
    const t = build({ failedLoginAttempts: 5, lockedUntil: FUTURE });
    expect(await login(t, 'Password123')).toBe('INVALID_CREDENTIALS');
    expect(t.sessions.open).not.toHaveBeenCalled();
    expect(t.users.registerFailedLogin).not.toHaveBeenCalled();
    expect(t.users.clearFailedLogins).not.toHaveBeenCalled();
  });

  it('Escenario 3: contraseña incorrecta durante el bloqueo tampoco cuenta ni alarga el bloqueo', async () => {
    const t = build({ failedLoginAttempts: 5, lockedUntil: FUTURE });
    expect(await login(t, 'Incorrecta1')).toBe('INVALID_CREDENTIALS');
    expect(t.users.registerFailedLogin).not.toHaveBeenCalled();
  });

  it('Escenario 4: bloqueada, contraseña incorrecta y correo inexistente → mismo código y mensaje, con Argon2 verificado en los tres', async () => {
    const outcome = async (t: ReturnType<typeof build>, email: string, password: string) => {
      await t.service.onModuleInit();
      t.hasher.verify.mockClear();
      try {
        await t.service.authenticate(email, password);
      } catch (err) {
        return { response: (err as HttpException).getResponse(), verifies: t.hasher.verify.mock.calls.length };
      }
      throw new Error('debía fallar');
    };
    const locked = await outcome(build({ lockedUntil: FUTURE }), 'ana@test.com', 'Password123');
    const wrong = await outcome(build(), 'ana@test.com', 'Incorrecta1');
    const unknownTest = build();
    unknownTest.users.findByEmail.mockResolvedValue(null);
    const unknown = await outcome(unknownTest, 'nadie@test.com', 'Password123');

    expect(locked.response).toEqual(wrong.response);
    expect(unknown.response).toEqual(wrong.response);
    expect(wrong.response).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect([locked.verifies, wrong.verifies, unknown.verifies]).toEqual([1, 1, 1]);
  });

  it('Escenario 5: login correcto sin bloqueo → contador a 0 y locked_until a NULL, tras abrir la sesión y en la misma transacción', async () => {
    const t = build({ failedLoginAttempts: 3 });
    expect(await login(t, 'Password123')).toBe('NO_ERROR');
    expect(t.users.clearFailedLogins).toHaveBeenCalledWith('u1', 'tx');
    expect(t.log).toEqual(['open', 'clear']);
  });

  it('Escenario 5: si el login no se completa (correo sin verificar, MFA) no se limpia el contador', async () => {
    const t = build({ emailVerified: false });
    expect(await login(t, 'Password123')).toBe('EMAIL_NOT_VERIFIED');
    expect(t.users.clearFailedLogins).not.toHaveBeenCalled();
  });
});

describe('SPEC-112: TypeOrmUserRepository (bloqueo progresivo, sin base de datos)', () => {
  const build = () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const manager = { query: jest.fn().mockResolvedValue(undefined), findOne: jest.fn(), update: jest.fn(), save: jest.fn() };
    const repo = new TypeOrmUserRepository({ query, manager } as never);
    return { repo, query, manager };
  };

  it('política: a partir del 5.º fallo, 60 s duplicándose hasta 30 min', () => {
    expect([LOCKOUT_THRESHOLD, LOCKOUT_BASE_SECONDS, LOCKOUT_MAX_SECONDS]).toEqual([5, 60, 1800]);
  });

  it('Escenarios 1, 2 y 7: registerFailedLogin es UN solo UPDATE atómico en SQL, sin leer antes ni usar transacción', async () => {
    const t = build();
    const now = new Date('2026-11-05T12:00:00Z');
    await t.repo.registerFailedLogin('u1', now);

    expect(t.query).toHaveBeenCalledTimes(1);
    const [sql, params] = t.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/UPDATE iam\."user"/);
    expect(sql).toMatch(/failed_login_attempts = LEAST\(failed_login_attempts \+ 1/); // incremento en SQL, no leer-modificar-escribir
    expect(sql).toMatch(/WHERE user_id = \$1\s*$/); // no condiciona por locked_until: los fallos simultáneos se cuentan todos
    expect(sql).not.toMatch(/SELECT/);
    expect(params).toEqual(['u1', now, 5, 60, 32767, 1800]);
    expect(t.manager.findOne).not.toHaveBeenCalled(); // sin lectura previa
    expect(t.manager.query).not.toHaveBeenCalled(); // por la conexión del pool, no por una transacción abierta
  });

  it('Escenarios 5 y 6: clearFailedLogins pone 0 y NULL, usando la transacción si se le da', async () => {
    const t = build();
    await t.repo.clearFailedLogins('u1', t.manager as never);
    const [sql, params] = t.manager.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/failed_login_attempts = 0, locked_until = NULL/);
    expect(params).toEqual(['u1']);
    expect(t.query).not.toHaveBeenCalled();
  });

  it('clearFailedLogins sin transacción usa el manager por defecto', async () => {
    const t = build();
    await t.repo.clearFailedLogins('u1');
    expect(t.manager.query).toHaveBeenCalledTimes(1);
  });
});
