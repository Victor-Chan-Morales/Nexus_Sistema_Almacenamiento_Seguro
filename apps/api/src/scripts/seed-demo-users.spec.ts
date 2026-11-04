import { Role } from '../modules/iam/domain/enums';
import { DEMO_ADMIN, DEMO_COLLABORATOR, resolveDemoPassword, seedDemoUsers } from './seed-demo-users';

const PASSWORD = 'demo-pass-123';
const ORG = 'org-1';

function buildDeps({ adminExists = false, collaboratorExists = false, adminRole = Role.TENANT_ADMIN, collaboratorInOrg = true } = {}) {
  const accounts = new Map<string, { id: string }>();
  if (adminExists) accounts.set(DEMO_ADMIN.email, { id: 'admin-1' });
  if (collaboratorExists) accounts.set(DEMO_COLLABORATOR.email, { id: 'collaborator-1' });
  const tx = { tx: true };
  return {
    tx,
    registration: {
      register: jest.fn(async () => {
        accounts.set(DEMO_ADMIN.email, { id: 'admin-1' });
        return {};
      }),
    },
    members: {
      addMember: jest.fn(async () => {
        accounts.set(DEMO_COLLABORATOR.email, { id: 'collaborator-1' });
        return {};
      }),
    },
    users: {
      findByEmail: jest.fn(async (email: string) => accounts.get(email) ?? null),
      setPasswordAndVerifyEmail: jest.fn(async () => undefined),
    },
    memberships: {
      findActive: jest.fn(async (userId: string) =>
        userId === 'admin-1'
          ? { organizationId: ORG, role: adminRole }
          : collaboratorInOrg ? { organizationId: ORG, role: Role.COLABORADOR } : null),
    },
    hasher: { hash: jest.fn(async () => 'argon2-hash') },
    uow: { run: jest.fn(async (work: (value: unknown) => Promise<unknown>) => work(tx)) },
    ensurePersonalDrive: jest.fn(async () => undefined),
  };
}

describe('resolveDemoPassword', () => {
  const env = { NODE_ENV: 'development', POSTGRES_HOST: '127.0.0.1', DEMO_PASSWORD: PASSWORD };

  it('returns a valid password for a local database', () => {
    expect(resolveDemoPassword(env)).toBe(PASSWORD);
  });

  it.each(['localhost', '::1', 'postgres'])('accepts the local host %s', (POSTGRES_HOST) => {
    expect(resolveDemoPassword({ ...env, POSTGRES_HOST })).toBe(PASSWORD);
  });

  it('refuses to run in production', () => {
    expect(() => resolveDemoPassword({ ...env, NODE_ENV: 'production' })).toThrow('NODE_ENV=production');
  });

  it('refuses a remote database', () => {
    expect(() => resolveDemoPassword({ ...env, POSTGRES_HOST: 'db.example.com' })).toThrow('base local');
  });

  it.each([undefined, '', 'short1', 'onlyletters', '12345678'])('rejects the password %p without echoing it', (DEMO_PASSWORD) => {
    expect(() => resolveDemoPassword({ ...env, DEMO_PASSWORD })).toThrow('Defina DEMO_PASSWORD');
  });
});

describe('seedDemoUsers', () => {
  it('creates both accounts through the API use cases and verifies them', async () => {
    const deps = buildDeps();

    await expect(seedDemoUsers(deps as never, PASSWORD)).resolves.toEqual([
      { email: DEMO_ADMIN.email, role: Role.TENANT_ADMIN, created: true },
      { email: DEMO_COLLABORATOR.email, role: Role.COLABORADOR, created: true },
    ]);

    expect(deps.registration.register).toHaveBeenCalledWith(expect.objectContaining({ email: DEMO_ADMIN.email, password: PASSWORD }));
    expect(deps.members.addMember).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1', organizationId: ORG }),
      expect.objectContaining({ email: DEMO_COLLABORATOR.email, role: Role.COLABORADOR }),
    );
    expect(deps.users.setPasswordAndVerifyEmail).toHaveBeenCalledWith(deps.tx, 'admin-1', 'argon2-hash');
    expect(deps.users.setPasswordAndVerifyEmail).toHaveBeenCalledWith(deps.tx, 'collaborator-1', 'argon2-hash');
    expect(deps.ensurePersonalDrive).toHaveBeenCalledWith(ORG, 'collaborator-1');
  });

  it('does not duplicate accounts on a second run and refreshes the password', async () => {
    const deps = buildDeps({ adminExists: true, collaboratorExists: true });

    await expect(seedDemoUsers(deps as never, PASSWORD)).resolves.toEqual([
      { email: DEMO_ADMIN.email, role: Role.TENANT_ADMIN, created: false },
      { email: DEMO_COLLABORATOR.email, role: Role.COLABORADOR, created: false },
    ]);

    expect(deps.registration.register).not.toHaveBeenCalled();
    expect(deps.members.addMember).not.toHaveBeenCalled();
    expect(deps.users.setPasswordAndVerifyEmail).toHaveBeenCalledTimes(2);
  });

  it('completes a partial run by adding only the missing collaborator', async () => {
    const deps = buildDeps({ adminExists: true });

    await seedDemoUsers(deps as never, PASSWORD);

    expect(deps.registration.register).not.toHaveBeenCalled();
    expect(deps.members.addMember).toHaveBeenCalledTimes(1);
  });

  it('does not change passwords when the admin email belongs to a non-admin', async () => {
    const deps = buildDeps({ adminExists: true, adminRole: Role.COLABORADOR });

    await expect(seedDemoUsers(deps as never, PASSWORD)).rejects.toThrow('no administra');
    expect(deps.users.setPasswordAndVerifyEmail).not.toHaveBeenCalled();
  });

  it('does not change passwords when the collaborator belongs to another organization', async () => {
    const deps = buildDeps({ adminExists: true, collaboratorExists: true, collaboratorInOrg: false });

    await expect(seedDemoUsers(deps as never, PASSWORD)).rejects.toThrow('no pertenece');
    expect(deps.users.setPasswordAndVerifyEmail).not.toHaveBeenCalled();
  });
});
