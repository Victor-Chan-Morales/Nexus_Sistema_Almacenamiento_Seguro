import { Membership } from './entities/membership.entity';
import { MemberAdmission } from './member-admission';
import { MembershipRepository } from './ports/repositories';

/** SPEC-220: consultas de miembros activos que usa Files para validar equipos. Regresión del límite de usuarios incluida. */

const ORG = 'org-1';

const membership = (userId: string, status: 'active' | 'suspended', organizationId = ORG): Membership =>
  ({
    userId,
    organizationId,
    status,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    user: { fullName: 'Nombre ' + userId, email: userId + '@example.com', passwordHash: 'secreto' },
  }) as unknown as Membership;

const repositoryWith = (rows: Membership[]) => {
  const listByOrganization = jest.fn(async (organizationId: string) =>
    rows.filter((row) => row.organizationId === organizationId),
  );
  return {
    repository: { listByOrganization } as unknown as MembershipRepository,
    listByOrganization,
  };
};

describe('MemberAdmission · miembros activos (SPEC-220)', () => {
  it('sin repositorio falla cerrada: no hay miembros y nadie es miembro', async () => {
    const admission = new MemberAdmission();

    expect(await admission.activeMembers(ORG)).toEqual([]);
    expect(await admission.isActiveMember(ORG, 'user-1')).toBe(false);
  });

  it('excluye las membresías suspendidas', async () => {
    const { repository } = repositoryWith([membership('user-1', 'active'), membership('user-2', 'suspended')]);
    const admission = new MemberAdmission(repository);

    const members = await admission.activeMembers(ORG);

    expect(members.map((member) => member.userId)).toEqual(['user-1']);
  });

  it('devuelve solo userId, fullName y email, sin hash de contraseña ni otros campos', async () => {
    const { repository } = repositoryWith([membership('user-1', 'active')]);
    const admission = new MemberAdmission(repository);

    const [member] = await admission.activeMembers(ORG);

    expect(member).toEqual({ userId: 'user-1', fullName: 'Nombre user-1', email: 'user-1@example.com' });
    expect(JSON.stringify(member)).not.toContain('secreto');
  });

  it('consulta solo la organización indicada', async () => {
    const { repository, listByOrganization } = repositoryWith([
      membership('user-1', 'active', ORG),
      membership('user-9', 'active', 'org-2'),
    ]);
    const admission = new MemberAdmission(repository);

    const members = await admission.activeMembers(ORG);

    expect(listByOrganization).toHaveBeenCalledWith(ORG);
    expect(members.map((member) => member.userId)).toEqual(['user-1']);
  });

  it('isActiveMember es verdadero solo para una membresía activa de la organización', async () => {
    const { repository } = repositoryWith([membership('user-1', 'active'), membership('user-2', 'suspended')]);
    const admission = new MemberAdmission(repository);

    expect(await admission.isActiveMember(ORG, 'user-1')).toBe(true);
    expect(await admission.isActiveMember(ORG, 'user-2')).toBe(false);
    expect(await admission.isActiveMember(ORG, 'user-404')).toBe(false);
  });

  it('el límite de usuarios sin fuente sigue devolviendo null (regresión)', async () => {
    expect(await new MemberAdmission().userLimit(ORG)).toBeNull();
  });

  it('registrar una fuente de límite reemplaza la anterior (regresión)', async () => {
    const admission = new MemberAdmission();
    admission.register(async () => 5);
    admission.register(async () => 12);

    expect(await admission.userLimit(ORG)).toBe(12);
  });
});
