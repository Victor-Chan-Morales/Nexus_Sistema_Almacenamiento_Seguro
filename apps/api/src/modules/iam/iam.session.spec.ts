import { UserStatus } from './domain/enums';
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
  return { service, sessions, memberships };
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
