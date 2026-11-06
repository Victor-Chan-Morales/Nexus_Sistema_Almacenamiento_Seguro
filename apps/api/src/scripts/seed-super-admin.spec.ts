import { resolveSuperAdminCredentials, seedSuperAdmin } from './seed-super-admin';

const CREDS = { email: 'dueno@nexus.com', password: 'Password123' };

const build = (existing: { id: string; isSuperAdmin: boolean } | null, hasMembership = true) => {
  const created = { id: 'u-new', isSuperAdmin: false };
  const users = { findByEmail: jest.fn().mockResolvedValueOnce(existing).mockResolvedValue(existing ?? created) };
  const registration = { register: jest.fn().mockResolvedValue(undefined) };
  const memberships = { findActive: jest.fn().mockResolvedValue(hasMembership ? { organizationId: 'o1' } : null) };
  const grantSuperAdmin = jest.fn().mockResolvedValue(undefined);
  return { deps: { users, registration, memberships, grantSuperAdmin } as never, users, registration, memberships, grantSuperAdmin };
};

describe('seed:super-admin (SPEC-501, Escenario 7)', () => {
  it('crea la cuenta con su organización interna "Nexus Plataforma" y le concede is_super_admin', async () => {
    const t = build(null);
    const result = await seedSuperAdmin(t.deps, CREDS);
    expect(t.registration.register).toHaveBeenCalledWith({
      fullName: 'Super Admin', email: 'dueno@nexus.com', password: 'Password123', organizationName: 'Nexus Plataforma',
    });
    expect(t.grantSuperAdmin).toHaveBeenCalledWith('u-new');
    expect(result).toEqual({ email: 'dueno@nexus.com', created: true });
  });

  it('repetir el comando no duplica nada: ni registro, ni concesión, ni cambio de contraseña', async () => {
    const t = build({ id: 'u1', isSuperAdmin: true });
    const result = await seedSuperAdmin(t.deps, CREDS);
    expect(t.registration.register).not.toHaveBeenCalled();
    expect(t.grantSuperAdmin).not.toHaveBeenCalled();
    expect(result).toEqual({ email: 'dueno@nexus.com', created: false });
  });

  it('nunca eleva una cuenta de cliente que ya existe', async () => {
    const t = build({ id: 'u2', isSuperAdmin: false });
    await expect(seedSuperAdmin(t.deps, CREDS)).rejects.toThrow(/no se eleva automáticamente/);
    expect(t.registration.register).not.toHaveBeenCalled();
    expect(t.grantSuperAdmin).not.toHaveBeenCalled();
  });

  it('si la cuenta quedó sin organización activa, falla en lugar de conceder el permiso', async () => {
    const t = build(null, false);
    await expect(seedSuperAdmin(t.deps, CREDS)).rejects.toThrow(/organización activa/);
    expect(t.grantSuperAdmin).not.toHaveBeenCalled();
  });
});

describe('resolveSuperAdminCredentials', () => {
  it('normaliza el correo y acepta una contraseña que cumple la política', () => {
    expect(resolveSuperAdminCredentials({ SUPER_ADMIN_EMAIL: ' Dueno@Nexus.com ', SUPER_ADMIN_PASSWORD: 'Password123' })).toEqual(CREDS);
  });

  it.each([
    [{}],
    [{ SUPER_ADMIN_EMAIL: 'dueno@nexus.com' }],
    [{ SUPER_ADMIN_PASSWORD: 'Password123' }],
    [{ SUPER_ADMIN_EMAIL: 'no-es-correo', SUPER_ADMIN_PASSWORD: 'Password123' }],
    [{ SUPER_ADMIN_EMAIL: 'dueno@nexus.com', SUPER_ADMIN_PASSWORD: 'corta1' }],
    [{ SUPER_ADMIN_EMAIL: 'dueno@nexus.com', SUPER_ADMIN_PASSWORD: 'sololetrasaaaa' }],
  ])('rechaza credenciales ausentes o inválidas: %j', (env) => {
    expect(() => resolveSuperAdminCredentials(env as NodeJS.ProcessEnv)).toThrow(/SUPER_ADMIN_EMAIL/);
  });
});
