import { HttpException } from '@nestjs/common';
import { MembershipStatus, OrgStatus, Role, TokenPurpose, UserStatus } from './domain/enums';
import { TypeOrmMembershipRepository } from './infrastructure/typeorm-repositories';
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
    });
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
