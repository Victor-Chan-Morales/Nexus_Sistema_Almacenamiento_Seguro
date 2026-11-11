import { HttpException } from '@nestjs/common';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { MEMBER_INVITATION_TOKEN_TTL_HOURS } from './constants';
import { Role, TokenPurpose } from './domain/enums';
import { IamSettings } from './iam.settings';
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
  isSuperAdmin: false,
};
const DTO = { fullName: 'Ana Pérez', email: ' ANA@Empresa.com ', role: Role.COLABORADOR };
const CREATED_AT = new Date('2026-10-29T12:00:00.000Z');

interface Options {
  checkEmailDomain?: boolean;
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
  const emailDomains = { check: jest.fn().mockResolvedValue('deliverable') };

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
    {} as never,
    {} as never,
    { checkEmailDomain: opts.checkEmailDomain ?? false } as IamSettings,
    emailDomains,
  );
  return { service, log, db, uow, users, organizations, memberships, hasher, opaque, outbox, audit, emailDomains };
};

describe('MembersService.addMember (sin base de datos: puertos simulados)', () => {
  it('rechaza un dominio inválido antes de abrir la transacción', async () => {
    const t = build({ checkEmailDomain: true });
    t.emailDomains.check.mockResolvedValue('undeliverable');
    await expect(t.service.addMember(ACTOR, DTO)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'EMAIL_DOMAIN_INVALID' }),
      status: 400,
    });
    expect(t.emailDomains.check).toHaveBeenCalledWith('empresa.com');
    expect(t.uow.run).not.toHaveBeenCalled();
    expect(t.outbox.enqueueWithToken).not.toHaveBeenCalled();
  });
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
      t.hasher as never, t.opaque as never, t.outbox as never, admission, t.audit as never, {} as never, {} as never,
      { checkEmailDomain: false } as IamSettings, t.emailDomains,
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
      {} as never, {} as never, {} as never, admission, {} as never, {} as never, {} as never,
      {} as never, {} as never,
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

describe('MembersService.update / remove (SPEC-108, puertos simulados con estado y rollback)', () => {
  type MemberRow = {
    id: string; userId: string; organizationId: string; role: Role; status: string; createdAt: Date;
    user: { fullName: string; email: string };
  };
  const row = (id: string, userId: string, role: Role, status = 'active', organizationId = 'ORG-1'): MemberRow => ({
    id, userId, organizationId, role, status, createdAt: new Date('2026-10-01T12:00:00Z'),
    user: { fullName: `Persona ${userId}`, email: `${userId}@empresa.com` },
  });
  const ADMIN = { ...ACTOR, userId: 'u-admin', role: Role.TENANT_ADMIN };

  const world = (members: MemberRow[], limit: number | null = 5) => {
    const log: string[] = [];
    const store = { rows: members.map((m) => ({ ...m })), userStatus: new Map(members.map((m) => [m.userId, 'active'])), revoked: [] as string[] };
    const snapshot = () => ({
      rows: store.rows.map((r) => ({ ...r })), userStatus: new Map(store.userStatus), revoked: [...store.revoked],
    });
    const uow = {
      run: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => {
        const before = snapshot();
        try {
          const result = await work('tx');
          log.push('commit');
          return result;
        } catch (err) {
          store.rows = before.rows; store.userStatus = before.userStatus; store.revoked = before.revoked;
          log.push('rollback');
          throw err;
        }
      }),
    };
    const memberships = {
      findActive: jest.fn(async (userId: string, organizationId?: string) =>
        store.rows.find((r) => r.userId === userId && r.status === 'active' && store.userStatus.get(userId) === 'active'
          && (!organizationId || r.organizationId === organizationId)) ?? null),
      findInOrganization: jest.fn(async (_tx: unknown, id: string, organizationId: string) =>
        store.rows.find((r) => r.id === id && r.organizationId === organizationId) ?? null),
      countActiveAdmins: jest.fn(async (_tx: unknown, organizationId: string) =>
        store.rows.filter((r) => r.organizationId === organizationId && r.status === 'active' && r.role === Role.TENANT_ADMIN
          && store.userStatus.get(r.userId) === 'active').length),
      countActiveInOrganization: jest.fn(async (_tx: unknown, organizationId: string) =>
        store.rows.filter((r) => r.organizationId === organizationId && r.status === 'active').length),
      updateRole: jest.fn(async (_tx: unknown, id: string, role: Role) => void (store.rows.find((r) => r.id === id)!.role = role)),
      updateStatus: jest.fn(async (_tx: unknown, id: string, status: string) => void (store.rows.find((r) => r.id === id)!.status = status)),
      remove: jest.fn(async (_tx: unknown, id: string) => void (store.rows = store.rows.filter((r) => r.id !== id))),
    };
    const users = { setStatus: jest.fn(async (_tx: unknown, userId: string, status: string) => void store.userStatus.set(userId, status)) };
    const sessions = { revokeAllActiveOf: jest.fn(async (_tx: unknown, userId: string) => void store.revoked.push(userId)) };
    const organizations = { lockById: jest.fn(async () => (log.push('lock'), true)) };
    const audit = { logEvent: jest.fn().mockResolvedValue(undefined) };
    const admission = new MemberAdmission();
    if (limit !== null) admission.register(async () => limit);
    const notices = { memberStatusChanged: jest.fn().mockResolvedValue(undefined) };
    const service = new MembersService(
      uow as never, users as never, organizations as never, memberships as never,
      {} as never, {} as never, {} as never, admission, audit as never, sessions as never, notices as never,
      {} as never, {} as never,
    );
    return { service, store, log, uow, memberships, users, sessions, organizations, audit, notices };
  };

  const base = () => [
    row('m-admin', 'u-admin', Role.TENANT_ADMIN),
    row('m-ana', 'u-ana', Role.COLABORADOR),
  ];

  // ---------- Escenario 1: cambiar rol ----------
  it('Escenario 1: cambia el rol, responde el miembro actualizado y lo audita tras el commit', async () => {
    const w = world(base());
    const result = await w.service.update(ADMIN, 'm-ana', { role: Role.TENANT_ADMIN });

    expect(result).toEqual({
      id: 'm-ana', userId: 'u-ana', fullName: 'Persona u-ana', email: 'u-ana@empresa.com',
      role: 'tenant_admin', status: 'active', joinedAt: '2026-10-01T12:00:00.000Z',
    });
    expect(w.store.rows.find((r) => r.id === 'm-ana')!.role).toBe(Role.TENANT_ADMIN);
    expect(w.sessions.revokeAllActiveOf).not.toHaveBeenCalled(); // el rol se relee en cada solicitud
    expect(w.audit.logEvent).toHaveBeenCalledTimes(1);
    expect(w.audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'ORG-1', actorId: 'u-admin', action: 'MEMBER_ROLE_CHANGED', resourceType: 'membership', resourceId: 'm-ana',
    }));
  });

  it('Escenario 1: el bloqueo de la organización se toma antes que cualquier lectura', async () => {
    const w = world(base());
    await w.service.update(ADMIN, 'm-ana', { role: Role.TENANT_ADMIN });
    expect(w.log).toEqual(['lock', 'commit']);
    expect(w.organizations.lockById).toHaveBeenCalledWith('tx', 'ORG-1');
  });

  // ---------- Escenarios 2 y 3: suspender y reactivar ----------
  it('Escenario 2: suspender revoca las sesiones y la siguiente solicitud con access token vigente deja de autenticarse', async () => {
    const w = world(base());
    const result = await w.service.update(ADMIN, 'm-ana', { status: 'suspended' as never });

    expect(result.status).toBe('suspended');
    expect(w.store.revoked).toEqual(['u-ana']);
    // JwtStrategy usa findActive en cada solicitud: sin membresía activa responde 401
    expect(await w.memberships.findActive('u-ana', 'ORG-1')).toBeNull();
    expect(w.audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'MEMBER_SUSPENDED', resourceId: 'm-ana' }));
    expect(w.notices.memberStatusChanged).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-ana' }));
    await w.service.update(ADMIN, 'm-ana', { status: 'suspended' as never });
    expect(w.notices.memberStatusChanged).toHaveBeenCalledTimes(1);
  });

  it('Escenario 3: reactivar con cupo deja la membresía activa de nuevo y lo audita', async () => {
    const w = world([...base(), row('m-bea', 'u-bea', Role.COLABORADOR, 'suspended')], 5);
    const result = await w.service.update(ADMIN, 'm-bea', { status: 'active' as never });

    expect(result.status).toBe('active');
    expect(await w.memberships.findActive('u-bea', 'ORG-1')).not.toBeNull(); // puede iniciar sesión otra vez
    expect(w.audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'MEMBER_REACTIVATED', resourceId: 'm-bea' }));
    expect(w.notices.memberStatusChanged).not.toHaveBeenCalled();
  });

  // ---------- Escenario 4: reactivar sin cupo ----------
  it('Escenario 4: reactivar con el límite alcanzado → USER_LIMIT_EXCEEDED y no cambia nada', async () => {
    const w = world([...base(), row('m-bea', 'u-bea', Role.COLABORADOR, 'suspended')], 2); // 2 activos de 2
    expect(await codeOf(w.service.update(ADMIN, 'm-bea', { status: 'active' as never }))).toBe('USER_LIMIT_EXCEEDED');
    expect(w.store.rows.find((r) => r.id === 'm-bea')!.status).toBe('suspended');
    expect(w.audit.logEvent).not.toHaveBeenCalled();
  });

  it('Escenario 4: sin plan vigente (o sin fuente) reactivar también falla cerrado', async () => {
    const w = world([...base(), row('m-bea', 'u-bea', Role.COLABORADOR, 'suspended')], null);
    expect(await codeOf(w.service.update(ADMIN, 'm-bea', { status: 'active' as never }))).toBe('USER_LIMIT_EXCEEDED');
  });

  it('suspender no consulta el límite ni exige cupo', async () => {
    const w = world(base(), 1); // ya por encima del límite
    expect(await codeOf(w.service.update(ADMIN, 'm-ana', { status: 'suspended' as never }))).toBe('NO_ERROR');
  });

  // ---------- Escenario 5: eliminar ----------
  it('Escenario 5: eliminar borra la membresía, deja la cuenta inactive, revoca sesiones y libera el cupo', async () => {
    const w = world(base());
    const before = await w.memberships.countActiveInOrganization('tx', 'ORG-1');
    await w.service.remove(ADMIN, 'm-ana');

    expect(w.store.rows.map((r) => r.id)).toEqual(['m-admin']);
    expect(w.users.setStatus).toHaveBeenCalledWith('tx', 'u-ana', 'inactive'); // la cuenta (y sus archivos) no se borran
    expect(w.store.userStatus.get('u-ana')).toBe('inactive');
    expect(w.store.revoked).toEqual(['u-ana']);
    expect(await w.memberships.countActiveInOrganization('tx', 'ORG-1')).toBe(before - 1);
    expect(w.audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'MEMBER_REMOVED', resourceType: 'membership', resourceId: 'm-ana' }));
    expect(w.notices.memberStatusChanged).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-ana' }));
  });

  it('Escenario 5: eliminar a un miembro suspendido también funciona', async () => {
    const w = world([...base(), row('m-bea', 'u-bea', Role.COLABORADOR, 'suspended')]);
    await w.service.remove(ADMIN, 'm-bea');
    expect(w.store.rows.find((r) => r.id === 'm-bea')).toBeUndefined();
  });

  // ---------- Escenario 6: último administrador ----------
  it('Escenario 6: el único administrador que intenta quitarse el rol → LAST_ADMIN_REQUIRED', async () => {
    const w = world(base());
    expect(await codeOf(w.service.update(ADMIN, 'm-admin', { role: Role.COLABORADOR }))).toBe('LAST_ADMIN_REQUIRED');
    expect(w.store.rows.find((r) => r.id === 'm-admin')!.role).toBe(Role.TENANT_ADMIN);
    expect(w.audit.logEvent).not.toHaveBeenCalled();
  });

  it('Escenario 6: con otro administrador activo, uno puede quitarse el rol', async () => {
    const w = world([...base(), row('m-otro', 'u-otro', Role.TENANT_ADMIN)]);
    const result = await w.service.update(ADMIN, 'm-admin', { role: Role.COLABORADOR });
    expect(result.role).toBe('colaborador');
  });

  it('Escenario 6: un administrador suspendido no cuenta como administrador activo', async () => {
    const w = world([...base(), row('m-otro', 'u-otro', Role.TENANT_ADMIN, 'suspended')]);
    expect(await codeOf(w.service.update(ADMIN, 'm-admin', { role: Role.COLABORADOR }))).toBe('LAST_ADMIN_REQUIRED');
  });

  // ---------- Escenario 7: concurrencia (el resultado de la serialización por el bloqueo) ----------
  it('Escenario 7: dos administradores que se eliminan entre sí → el segundo ya no es administrador y queda uno', async () => {
    const w = world([row('m-a', 'u-admin', Role.TENANT_ADMIN), row('m-b', 'u-b', Role.TENANT_ADMIN)]);
    const B = { ...ADMIN, userId: 'u-b' };

    // El bloqueo de la organización las ordena: la primera confirma y la segunda ve el estado ya cambiado.
    await w.service.remove(ADMIN, 'm-b');
    expect(await codeOf(w.service.remove(B, 'm-a'))).toBe('NO_ACTIVE_MEMBERSHIP');

    const activeAdmins = await w.memberships.countActiveAdmins('tx', 'ORG-1');
    expect(activeAdmins).toBe(1);
  });

  it('Escenario 7: el actor se revalida dentro de la transacción: un administrador degradado no puede actuar', async () => {
    const w = world([row('m-a', 'u-admin', Role.COLABORADOR), row('m-b', 'u-b', Role.TENANT_ADMIN)]);
    expect(await codeOf(w.service.remove(ADMIN, 'm-b'))).toBe('FORBIDDEN_ROLE'); // su token aún decía tenant_admin
    expect(w.store.rows).toHaveLength(2);
  });

  // ---------- Escenario 8: sobre uno mismo ----------
  it.each([
    ['suspenderse', (w: ReturnType<typeof world>) => w.service.update(ADMIN, 'm-admin', { status: 'suspended' as never })],
    ['eliminarse', (w: ReturnType<typeof world>) => w.service.remove(ADMIN, 'm-admin')],
    ['quitarse el rol y suspenderse a la vez', (w: ReturnType<typeof world>) =>
      w.service.update(ADMIN, 'm-admin', { role: Role.COLABORADOR, status: 'suspended' as never })],
  ])('Escenario 8: intentar %s → CANNOT_MODIFY_SELF, aunque sea el único administrador', async (_name, act) => {
    const w = world(base());
    expect(await codeOf(act(w))).toBe('CANNOT_MODIFY_SELF');
    expect(w.store.rows.find((r) => r.id === 'm-admin')!.status).toBe('active');
  });

  it('Escenario 8: con otro administrador activo sigue siendo CANNOT_MODIFY_SELF', async () => {
    const w = world([...base(), row('m-otro', 'u-otro', Role.TENANT_ADMIN)]);
    expect(await codeOf(w.service.remove(ADMIN, 'm-admin'))).toBe('CANNOT_MODIFY_SELF');
  });

  // ---------- Escenario 9: aislamiento ----------
  it('Escenario 9: una membresía de otra organización es 404 NOT_FOUND y no se toca', async () => {
    const w = world([...base(), row('m-ajena', 'u-ajena', Role.COLABORADOR, 'active', 'ORG-2')]);
    expect(await codeOf(w.service.update(ADMIN, 'm-ajena', { role: Role.TENANT_ADMIN }))).toBe('NOT_FOUND');
    expect(await codeOf(w.service.remove(ADMIN, 'm-ajena'))).toBe('NOT_FOUND');
    expect(w.store.rows.find((r) => r.id === 'm-ajena')!.role).toBe(Role.COLABORADOR);
    expect(w.memberships.findInOrganization).toHaveBeenCalledWith('tx', 'm-ajena', 'ORG-1'); // filtra por la organización del token
  });

  it('Escenario 9: un id inexistente es 404 NOT_FOUND', async () => {
    const w = world(base());
    expect(await codeOf(w.service.update(ADMIN, 'no-existe', { role: Role.TENANT_ADMIN }))).toBe('NOT_FOUND');
    expect(await codeOf(w.service.remove(ADMIN, 'no-existe'))).toBe('NOT_FOUND');
  });

  // ---------- Comportamiento general ----------
  it('sin cambios reales (mismo rol y estado) responde el miembro actual sin escribir ni auditar', async () => {
    const w = world(base());
    const result = await w.service.update(ADMIN, 'm-ana', { role: Role.COLABORADOR, status: 'active' as never });
    expect(result.role).toBe('colaborador');
    expect(w.memberships.updateRole).not.toHaveBeenCalled();
    expect(w.memberships.updateStatus).not.toHaveBeenCalled();
    expect(w.audit.logEvent).not.toHaveBeenCalled();
  });

  it('rol y estado en la misma solicitud generan dos eventos con el mismo correlationId', async () => {
    const w = world(base());
    await w.service.update(ADMIN, 'm-ana', { role: Role.TENANT_ADMIN, status: 'suspended' as never });
    const calls = w.audit.logEvent.mock.calls.map(([event]) => event);
    expect(calls.map((c) => c.action)).toEqual(['MEMBER_ROLE_CHANGED', 'MEMBER_SUSPENDED']);
    expect(calls[0].correlationId).toBeDefined();
    expect(calls[0].correlationId).toBe(calls[1].correlationId);
  });

  it('un fallo de la auditoría no rompe la operación ni la respuesta', async () => {
    const w = world(base());
    w.audit.logEvent.mockRejectedValue(new Error('Audit DB down'));
    await expect(w.service.update(ADMIN, 'm-ana', { role: Role.TENANT_ADMIN })).resolves.toMatchObject({ role: 'tenant_admin' });
    await expect(w.service.remove(ADMIN, 'm-ana')).resolves.toBeUndefined();
  });

  it('si falla una escritura se revierte todo y no se audita ni se revocan sesiones', async () => {
    const w = world(base());
    w.sessions.revokeAllActiveOf.mockRejectedValueOnce(new Error('falla'));
    await expect(w.service.update(ADMIN, 'm-ana', { status: 'suspended' as never })).rejects.toThrow();
    expect(w.store.rows.find((r) => r.id === 'm-ana')!.status).toBe('active');
    expect(w.audit.logEvent).not.toHaveBeenCalled();
  });
});
