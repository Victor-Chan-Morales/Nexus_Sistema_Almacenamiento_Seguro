import { Role, UserStatus } from './domain/enums';
import { IamController } from './iam.controller';
import { SessionService } from './services/session.service';

const build = (membership: unknown) => {
  const session = {
    id: 's1',
    userId: 'u1',
    organizationId: 'o1',
    isRevoked: () => false,
    isExpired: () => false,
  };
  const user = {
    id: 'u1',
    email: 'ana@test.com',
    fullName: 'Ana',
    status: UserStatus.ACTIVE,
    mfaEnabled: false,
    emailVerified: true,
  };
  const sessions = {
    findByRefreshHashForUpdate: jest.fn().mockResolvedValue(session),
    revoke: jest.fn(),
    revokeAllActiveOf: jest.fn(),
    create: jest.fn().mockResolvedValue({ id: 's2' }),
  };
  const users = { findById: jest.fn().mockResolvedValue(user) };
  const memberships = { findActive: jest.fn().mockResolvedValue(membership) };
  const uow = { run: jest.fn((work: (tx: unknown) => unknown) => work('tx')) };
  const accessTokens = {
    issue: jest.fn().mockResolvedValue({ token: 'access', expiresAt: new Date() }),
  };
  const opaque = {
    hash: jest.fn((t: string) => `h(${t})`),
    generate: jest.fn().mockReturnValue('nuevo-refresh'),
  };
  const settings = { requireVerifiedEmail: true };
  const service = new SessionService(
    sessions as never,
    users as never,
    memberships as never,
    uow as never,
    accessTokens as never,
    opaque as never,
    settings as never,
  );
  return { service, sessions, memberships, users, accessTokens };
};

const activeMembership = {
  userId: 'u1',
  organizationId: 'o1',
  role: 'tenant_admin',
  organization: { id: 'o1', name: 'Empresa SA' },
};

describe('SessionService.refresh (la organización de la sesión se conserva)', () => {
  it('busca la membresía en la organización de la sesión, no en la primera membresía', async () => {
    const t = build(activeMembership);

    await t.service.refresh('refresh-viejo');

    expect(t.memberships.findActive).toHaveBeenCalledWith('u1', 'o1', 'tx');
  });

  it('la sesión nueva conserva la misma organización', async () => {
    const t = build(activeMembership);

    await t.service.refresh('refresh-viejo');

    expect(t.sessions.create).toHaveBeenCalledWith('tx', expect.objectContaining({ organizationId: 'o1' }));
  });

  it('si la membresía de esa organización ya no está activa, la sesión se rechaza y no se crea otra', async () => {
    const t = build(null);

    await expect(t.service.refresh('refresh-viejo')).rejects.toThrow();
    expect(t.sessions.create).not.toHaveBeenCalled();
  });
});

describe('SPEC-501: isSuperAdmin en la sesión', () => {
  it('Escenario 1: open() lo toma del usuario de la base; false para los demás', async () => {
    const t = build(activeMembership);
    const admin = { id: 'u1', email: 'dueno@nexus.com', fullName: 'Dueño', isSuperAdmin: true };
    const regular = { id: 'u2', email: 'ana@test.com', fullName: 'Ana', isSuperAdmin: false };
    const legacy = { id: 'u3', email: 'x@test.com', fullName: 'X' }; // sin el campo

    expect((await t.service.open('tx' as never, admin as never, activeMembership as never)).isSuperAdmin).toBe(true);
    expect((await t.service.open('tx' as never, regular as never, activeMembership as never)).isSuperAdmin).toBe(false);
    expect((await t.service.open('tx' as never, legacy as never, activeMembership as never)).isSuperAdmin).toBe(false);
  });

  it('Escenario 1: el access token NO lleva isSuperAdmin (solo sub, org y role)', async () => {
    const t = build(activeMembership);
    await t.service.open('tx' as never, { id: 'u1', fullName: 'Dueño', email: 'd@n.com', isSuperAdmin: true } as never, activeMembership as never);
    expect(t.accessTokens.issue).toHaveBeenCalledWith({ sub: 'u1', org: 'o1', role: 'tenant_admin' });
  });

  it('Escenario 1: refresh también devuelve isSuperAdmin leído de la base', async () => {
    const t = build(activeMembership);
    t.users.findById.mockResolvedValue({
      id: 'u1', email: 'd@n.com', fullName: 'Dueño', status: UserStatus.ACTIVE,
      mfaEnabled: false, emailVerified: true, isSuperAdmin: true,
    });
    expect((await t.service.refresh('refresh-viejo')).isSuperAdmin).toBe(true);
  });
});

describe('SPEC-501: IamController (login, refresh y /auth/me)', () => {
  const controller = new IamController({} as never, {} as never, {} as never, { refreshCookie: { secure: false, sameSite: 'lax' } } as never, {} as never);
  const authUser = (isSuperAdmin: boolean) => ({
    userId: 'u1', organizationId: 'o1', role: Role.TENANT_ADMIN,
    email: 'd@n.com', fullName: 'Dueño', organizationName: 'Nexus Plataforma', isSuperAdmin,
  });

  it('Escenario 1: /auth/me incluye isSuperAdmin (true para el Super Admin, false para los demás)', () => {
    expect(controller.me(authUser(true))).toEqual({
      user: { id: 'u1', fullName: 'Dueño', email: 'd@n.com' },
      organization: { id: 'o1', name: 'Nexus Plataforma' },
      role: 'tenant_admin',
      isSuperAdmin: true,
    });
    expect(controller.me(authUser(false)).isSuperAdmin).toBe(false);
  });

  it('Escenario 1: el login devuelve isSuperAdmin en el cuerpo (el refresh token solo va en la cookie)', async () => {
    const result = {
      refreshToken: 'r', accessToken: 'a', expiresAt: '2026-11-05T00:00:00.000Z',
      user: { id: 'u1', fullName: 'Dueño', email: 'd@n.com' }, organization: { id: 'o1', name: 'N' },
      role: Role.TENANT_ADMIN, isSuperAdmin: true,
    };
    const auth = { authenticate: jest.fn().mockResolvedValue(result) };
    const c = new IamController(auth as never, {} as never, {} as never, { refreshCookie: { secure: false, sameSite: 'lax' } } as never, {} as never);
    const res = { cookie: jest.fn() };
    const body = await c.login({ email: 'd@n.com', password: 'x' } as never, res as never);
    expect(body.isSuperAdmin).toBe(true);
    expect(JSON.stringify(body)).not.toContain('"r"');
  });
});
