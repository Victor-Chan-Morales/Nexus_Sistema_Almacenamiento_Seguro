import { HttpException } from '@nestjs/common';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { MEMBER_INVITATION_TOKEN_TTL_HOURS } from './constants';
import { Role, TokenPurpose } from './domain/enums';
import { MemberAdmission } from './member-admission';
import { MembersService } from './services/members.service';

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (err) {
    return (err as HttpException).getResponse()['code'] as string;
  }
  return 'NO_ERROR';
};

const ACTOR = {
  userId: 'admin-1',
  organizationId: 'ORG-1',
  role: Role.TENANT_ADMIN,
  email: 'admin@empresa.com',
  fullName: 'Admin',
  organizationName: 'Empresa SA',
};
const DTO = { fullName: 'Ana Pérez', email: ' ANA@Empresa.com ', role: Role.COLABORADOR };
const CREATED_AT = new Date('2026-10-29T12:00:00.000Z');

interface Options {
  existing?: { id: string } | null;
  organizationIds?: string[];
  activeCount?: number;
  limit?: number | null; // null = sin fuente/plan
  failOn?: 'membership' | 'token' | 'outbox';
}

/** Base en memoria con rollback: si el trabajo de la transacción lanza, se deshace todo lo escrito. */
const build = (opts: Options = {}) => {
  const log: string[] = [];
  const db: Record<'users' | 'memberships' | 'tokens' | 'outbox', unknown[]> = {
    users: [],
    memberships: [],
    tokens: [],
    outbox: [],
  };

  const uow = {
    run: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => {
      const sizes = Object.fromEntries(Object.entries(db).map(([key, rows]) => [key, rows.length]));
      try {
        const result = await work('tx');
        log.push('commit');
        return result;
      } catch (err) {
        for (const [key, rows] of Object.entries(db)) rows.length = sizes[key];
        log.push('rollback');
        throw err;
      }
    }),
  };

  const users = {
    findByEmail: jest.fn().mockResolvedValue(opts.existing ?? null),
    create: jest.fn(async (_tx: unknown, data: { email: string; fullName: string }) => {
      const user = { id: 'u-new', email: data.email, fullName: data.fullName };
      db.users.push(user);
      return user;
    }),
  };
  const organizations = { lockById: jest.fn(async () => (log.push('lock'), true)) };
  const memberships = {
    organizationIdsOfUser: jest.fn().mockResolvedValue(opts.organizationIds ?? []),
    countActiveInOrganization: jest.fn().mockResolvedValue(opts.activeCount ?? 0),
    create: jest.fn(async () => {
      if (opts.failOn === 'membership') throw new Error('falla membresía');
      const membership = { id: 'm-new', status: 'active', createdAt: CREATED_AT };
      db.memberships.push(membership);
      return membership;
    }),
  };
  const hasher = { hash: jest.fn(async (plain: string) => `hash:${plain}`) };
  const opaque = { generate: jest.fn().mockReturnValue('secreto-aleatorio') };
  const outbox = {
    // Emite el token (guardando solo su hash) y encola el mensaje, dentro de la misma transacción.
    enqueueWithToken: jest.fn(async () => {
      if (opts.failOn === 'token') throw new Error('falla token');
      db.tokens.push({});
      if (opts.failOn === 'outbox') throw new Error('falla outbox');
      db.outbox.push({});
      return 'outbox-1';
    }),
    dispatch: jest.fn(async () => void log.push('dispatch')),
  };
  const admission = new MemberAdmission();
  if (opts.limit !== null) {
    admission.register(async () => (log.push('limit'), opts.limit ?? 5));
  }

  const audit = { logEvent: jest.fn().mockResolvedValue(undefined) };

  const service = new MembersService(
    uow as never,
    users as never,
    organizations as never,
    memberships as never,
    hasher as never,
    opaque as never,
    outbox as never,
    admission,
    audit as never,
  );
  return { service, log, db, uow, users, organizations, memberships, hasher, opaque, outbox, audit };
};

describe('MembersService.addMember (sin base de datos: puertos simulados)', () => {
  it('Escenario 1: crea usuario y membresía activa en la organización del actor y encola la invitación', async () => {
    const t = build();
    const result = await t.service.addMember(ACTOR, DTO);

    expect(t.uow.run).toHaveBeenCalledTimes(1);
    expect(t.users.findByEmail).toHaveBeenCalledWith('ana@empresa.com', 'tx'); // normalizado, dentro de la transacción
    expect(t.users.create).toHaveBeenCalledWith('tx', {
      email: 'ana@empresa.com',
      fullName: 'Ana Pérez',
      passwordHash: 'hash:secreto-aleatorio', // Argon2id de un secreto que nadie conoce
    });
    expect(t.memberships.create).toHaveBeenCalledWith('tx', {
      userId: 'u-new',
      organizationId: 'ORG-1',
      role: Role.COLABORADOR,
    });
    expect(t.outbox.enqueueWithToken).toHaveBeenCalledWith('tx', {
      kind: 'member_invitation',
      userId: 'u-new',
      recipientEmail: 'ana@empresa.com',
      recipientName: 'Ana Pérez',
      purpose: TokenPurpose.PASSWORD_RESET,
      ttlMinutes: MEMBER_INVITATION_TOKEN_TTL_HOURS * 60,
    });
    expect(result).toEqual({
      id: 'm-new',
      userId: 'u-new',
      email: 'ana@empresa.com',
      fullName: 'Ana Pérez',
      role: Role.COLABORADOR,
      status: 'active',
      createdAt: '2026-10-29T12:00:00.000Z',
    });
  });

  it('Escenario 1: el correo se envía después del commit y la organización se bloquea antes de contar', async () => {
    const t = build();
    await t.service.addMember(ACTOR, DTO);
    expect(t.log).toEqual(['limit', 'lock', 'commit', 'dispatch']);
    expect(t.outbox.dispatch).toHaveBeenCalledWith('outbox-1');
  });

  it('el límite se lee una sola vez y antes de abrir la transacción (no retiene una conexión extra del pool)', async () => {
    const t = build({ activeCount: 1, limit: 5 });
    await t.service.addMember(ACTOR, DTO);
    expect(t.log.indexOf('limit')).toBeLessThan(t.log.indexOf('lock'));
    expect(t.uow.run).toHaveBeenCalledTimes(1);
    expect(t.log.filter((entry) => entry === 'limit')).toHaveLength(1);
  });

  it('Escenario 1: el 24 h de la invitación es el contrato (token de un solo uso con TTL de 1440 min)', () => {
    expect(MEMBER_INVITATION_TOKEN_TTL_HOURS * 60).toBe(1440);
  });

  it('Escenario 3: ya es miembro de esta organización → MEMBER_ALREADY_EXISTS y no se crea nada', async () => {
    const t = build({ existing: { id: 'u-ana' }, organizationIds: ['ORG-1'] });
    expect(await codeOf(t.service.addMember(ACTOR, DTO))).toBe('MEMBER_ALREADY_EXISTS');
    expect(t.users.create).not.toHaveBeenCalled();
    expect(t.outbox.dispatch).not.toHaveBeenCalled();
  });

  it('Escenario 4: el correo pertenece a otra organización → 422 y no se modifica esa cuenta', async () => {
    const t = build({ existing: { id: 'u-ana' }, organizationIds: ['ORG-2'] });
    expect(await codeOf(t.service.addMember(ACTOR, DTO))).toBe('EMAIL_BELONGS_TO_OTHER_ORGANIZATION');
    expect(t.users.create).not.toHaveBeenCalled();
    expect(t.memberships.create).not.toHaveBeenCalled();
    expect(t.outbox.enqueueWithToken).not.toHaveBeenCalled(); // no se emite token para la cuenta ajena
    expect(t.outbox.dispatch).not.toHaveBeenCalled();
  });

  it('Escenario 4: una cuenta existente sin ninguna membresía tampoco se reutiliza', async () => {
    const t = build({ existing: { id: 'u-huerfano' }, organizationIds: [] });
    expect(await codeOf(t.service.addMember(ACTOR, DTO))).toBe('EMAIL_BELONGS_TO_OTHER_ORGANIZATION');
  });

  it('Escenario 4: carrera con otro registro del mismo correo (UNIQUE 23505) → EMAIL_BELONGS_TO_OTHER_ORGANIZATION', async () => {
    const t = build();
    t.users.create.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }));
    expect(await codeOf(t.service.addMember(ACTOR, DTO))).toBe('EMAIL_BELONGS_TO_OTHER_ORGANIZATION');
  });

  it('el chequeo de membresía propia va antes que el del límite', async () => {
    const t = build({ existing: { id: 'u-ana' }, organizationIds: ['ORG-1'], activeCount: 5, limit: 5 });
    expect(await codeOf(t.service.addMember(ACTOR, DTO))).toBe('MEMBER_ALREADY_EXISTS');
  });

  it.each<[string, Options]>([
    ['MEMBER_ALREADY_EXISTS', { existing: { id: 'u-ana' }, organizationIds: ['ORG-1'] }],
    ['EMAIL_BELONGS_TO_OTHER_ORGANIZATION', { existing: { id: 'u-ana' }, organizationIds: ['ORG-2'] }],
    ['USER_LIMIT_EXCEEDED', { activeCount: 5, limit: 5 }],
  ])('%s no calcula el hash de Argon2 (no paga el coste de un alta rechazada)', async (code, opts) => {
    const t = build(opts);
    expect(await codeOf(t.service.addMember(ACTOR, DTO))).toBe(code);
    expect(t.hasher.hash).not.toHaveBeenCalled();
  });

  it('Escenario 5: miembros activos = límite del plan (Demo: 5) → USER_LIMIT_EXCEEDED', async () => {
    const t = build({ activeCount: 5, limit: 5 });
    expect(await codeOf(t.service.addMember(ACTOR, DTO))).toBe('USER_LIMIT_EXCEEDED');
    expect(t.memberships.countActiveInOrganization).toHaveBeenCalledWith('tx', 'ORG-1');
    expect(t.users.create).not.toHaveBeenCalled();
  });

  it('Escenario 5: con cupo disponible (4 de 5) sí permite el alta', async () => {
    const t = build({ activeCount: 4, limit: 5 });
    expect(await codeOf(t.service.addMember(ACTOR, DTO))).toBe('NO_ERROR');
  });

  it('Escenario 5: sin plan vigente (la fuente devuelve null) → USER_LIMIT_EXCEEDED', async () => {
    const t = build({ activeCount: 0, limit: 5 });
    const admission = new MemberAdmission();
    admission.register(async () => null);
    const service = new MembersService(
      t.uow as never, t.users as never, t.organizations as never, t.memberships as never,
      t.hasher as never, t.opaque as never, t.outbox as never, admission, t.audit as never,
    );
    expect(await codeOf(service.addMember(ACTOR, DTO))).toBe('USER_LIMIT_EXCEEDED');
  });

  it('Escenario 5: sin fuente de límite registrada → USER_LIMIT_EXCEEDED (falla cerrada)', async () => {
    const t = build({ activeCount: 0, limit: null });
    expect(await codeOf(t.service.addMember(ACTOR, DTO))).toBe('USER_LIMIT_EXCEEDED');
  });

  it.each(['membership', 'token', 'outbox'] as const)(
    'Escenario 6: si falla %s no queda usuario, membresía, token ni mensaje, y no se envía nada',
    async (failOn) => {
      const t = build({ failOn });
      await expect(t.service.addMember(ACTOR, DTO)).rejects.toThrow();
      expect(t.db).toEqual({ users: [], memberships: [], tokens: [], outbox: [] });
      expect(t.log).toContain('rollback');
      expect(t.outbox.dispatch).not.toHaveBeenCalled();
    },
  );

  it('Escenario 7: la organización del alta es siempre la del token del actor', async () => {
    const t = build();
    const hostile = { ...DTO, organizationId: 'ORG-AJENA' } as typeof DTO;
    await t.service.addMember(ACTOR, hostile);
    expect(t.organizations.lockById).toHaveBeenCalledWith('tx', 'ORG-1');
    expect(t.memberships.create).toHaveBeenCalledWith('tx', expect.objectContaining({ organizationId: 'ORG-1' }));
    expect(JSON.stringify(t.memberships.create.mock.calls)).not.toContain('ORG-AJENA');
  });
});

describe('SPEC-405: MembersService.addMember registra MEMBER_ADDED', () => {
  it('Escenario 1: tras el commit registra el evento con la organización del actor y la membresía creada', async () => {
    const t = build();
    await t.service.addMember(ACTOR, DTO);
    expect(t.audit.logEvent).toHaveBeenCalledTimes(1);
    expect(t.audit.logEvent).toHaveBeenCalledWith({
      organizationId: 'ORG-1',
      actorId: 'admin-1',
      action: AuditAction.MEMBER_ADDED,
      resourceType: AuditResource.MEMBERSHIP,
      resourceId: 'm-new',
    });
  });

  it.each<[string, Options]>([
    ['MEMBER_ALREADY_EXISTS', { existing: { id: 'u-ana' }, organizationIds: ['ORG-1'] }],
    ['USER_LIMIT_EXCEEDED', { activeCount: 5, limit: 5 }],
  ])('Escenario 2: si el alta se rechaza (%s) no registra evento', async (code, opts) => {
    const t = build(opts);
    expect(await codeOf(t.service.addMember(ACTOR, DTO))).toBe(code);
    expect(t.audit.logEvent).not.toHaveBeenCalled();
  });

  it('Escenario 3: si logEvent falla, el alta responde igual', async () => {
    const t = build();
    t.audit.logEvent.mockRejectedValueOnce(new Error('Audit DB down'));
    await expect(t.service.addMember(ACTOR, DTO)).resolves.toMatchObject({ id: 'm-new', userId: 'u-new' });
  });

  it('Escenario 4: el evento se registra después del commit y del envío de la invitación', async () => {
    const t = build();
    t.audit.logEvent.mockImplementationOnce(async () => void t.log.push('audit'));
    await t.service.addMember(ACTOR, DTO);
    expect(t.log).toEqual(['limit', 'lock', 'commit', 'dispatch', 'audit']);
  });
});

describe('MemberAdmission', () => {
  it('sin fuente registrada devuelve null (MembersService lo trata como límite 0)', async () => {
    expect(await new MemberAdmission().userLimit('ORG-1')).toBeNull();
  });

  it('delega en la fuente registrada y registrar de nuevo la reemplaza', async () => {
    const admission = new MemberAdmission();
    admission.register(async () => 5);
    admission.register(async (organizationId) => (organizationId === 'ORG-1' ? 10 : 0));
    expect(await admission.userLimit('ORG-1')).toBe(10);
  });
});

describe('MembersService.list (SPEC-104)', () => {
  const stamp = (n: number) => new Date(Date.UTC(2026, 9, n, 12));
  /** Membresías de dos organizaciones; el usuario trae campos que jamás deben salir. */
  const all = [
    { id: 'm1', userId: 'u1', organizationId: 'ORG-1', status: 'active', createdAt: stamp(1), role: Role.TENANT_ADMIN,
      user: { fullName: 'Admin Uno', email: 'admin@empresa.com', passwordHash: 'argon2id$SECRETO', mfaSecretEncrypted: 'MFA' } },
    { id: 'm2', userId: 'u2', organizationId: 'ORG-1', status: 'suspended', createdAt: stamp(2), role: Role.COLABORADOR,
      user: { fullName: 'Ana Pérez', email: 'ana@empresa.com', passwordHash: 'argon2id$OTRO', refreshTokenHash: 'RT' } },
    { id: 'm3', userId: 'u3', organizationId: 'ORG-2', status: 'active', createdAt: stamp(3), role: Role.TENANT_ADMIN,
      user: { fullName: 'Intruso Dos', email: 'intruso@otra.com', passwordHash: 'argon2id$AJENO' } },
  ];

  const build = (limit: number | null = 5) => {
    // El repositorio simulado filtra como la consulta real: WHERE organization_id = :orgId
    const memberships = {
      listByOrganization: jest.fn(async (organizationId: string) =>
        all.filter((row) => row.organizationId === organizationId)),
    };
    const admission = new MemberAdmission();
    if (limit !== null) admission.register(async () => limit);
    const service = new MembersService(
      {} as never, {} as never, {} as never, memberships as never,
      {} as never, {} as never, {} as never, admission, {} as never,
    );
    return { service, memberships, admission };
  };

  it('Escenario 1: lista los miembros de la organización con el contrato exacto, totalMembers y userLimit', async () => {
    const t = build(5);
    const result = await t.service.list(ACTOR);

    expect(t.memberships.listByOrganization).toHaveBeenCalledWith('ORG-1');
    expect(result).toEqual({
      members: [
        { id: 'm1', userId: 'u1', fullName: 'Admin Uno', email: 'admin@empresa.com', role: 'tenant_admin',
          status: 'active', joinedAt: '2026-10-01T12:00:00.000Z' },
        { id: 'm2', userId: 'u2', fullName: 'Ana Pérez', email: 'ana@empresa.com', role: 'colaborador',
          status: 'suspended', joinedAt: '2026-10-02T12:00:00.000Z' },
      ],
      totalMembers: 2, // los suspendidos se listan y cuentan aquí; el cupo del plan solo mira los activos
      userLimit: 5,
    });
  });

  it('Escenario 1: userLimit es null si no hay plan vigente o no hay fuente registrada', async () => {
    expect((await build(null).service.list(ACTOR)).userLimit).toBeNull();

    const sinPlan = build(5);
    sinPlan.admission.register(async () => null);
    expect((await sinPlan.service.list(ACTOR)).userLimit).toBeNull();
  });

  it('Escenario 1: una organización sin otros miembros devuelve su lista y el total', async () => {
    const solo = { ...ACTOR, organizationId: 'ORG-2' };
    const result = await build(10).service.list(solo);
    expect(result.members.map((m) => m.id)).toEqual(['m3']);
    expect(result.totalMembers).toBe(1);
    expect(result.userLimit).toBe(10);
  });

  it('Escenario 2: ningún miembro de otra organización aparece (se consulta solo por la organización del actor)', async () => {
    const t = build();
    const result = await t.service.list(ACTOR);
    expect(result.members.map((m) => m.userId)).not.toContain('u3');
    expect(JSON.stringify(result)).not.toContain('intruso@otra.com');
    expect(t.memberships.listByOrganization.mock.calls).toEqual([['ORG-1']]);
  });

  it('Escenario 4: la respuesta nunca incluye hash de contraseña, tokens ni campos de sesión', async () => {
    const result = await build().service.list(ACTOR);
    const json = JSON.stringify(result);
    for (const secret of ['argon2id', 'SECRETO', 'passwordHash', 'password', 'mfa', 'MFA', 'refresh', 'RT', 'token']) {
      expect(json).not.toContain(secret);
    }
    // solo las claves del contrato, nada más
    for (const member of result.members) {
      expect(Object.keys(member).sort()).toEqual(
        ['email', 'fullName', 'id', 'joinedAt', 'role', 'status', 'userId'],
      );
    }
    expect(Object.keys(result).sort()).toEqual(['members', 'totalMembers', 'userLimit']);
  });
});
