import { HttpException } from '@nestjs/common';
import { INITIAL_DEPLOYMENT_MODEL, Role } from './domain/enums';
import { RegistrationHooks } from './registration-hooks';
import { RegistrationService } from './services/registration.service';

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (err) {
    return (err as HttpException).getResponse()['code'] as string;
  }
  return 'NO_ERROR';
};

const DTO = {
  fullName: 'Ana Pérez',
  email: ' ANA@Test.com ',
  password: 'Password123',
  organizationName: 'Empresa SA',
};

/** Orden de las operaciones, para comprobar que los hooks van dentro de la transacción y antes del token. */
const build = () => {
  const order: string[] = [];
  const user = { id: 'u1', email: 'ana@test.com', fullName: 'Ana Pérez' };
  const organization = { id: 'o1', name: 'Empresa SA' };

  const users = {
    findByEmail: jest.fn().mockResolvedValue(null),
    create: jest.fn(async () => (order.push('user'), user)),
  };
  const organizations = { create: jest.fn(async () => (order.push('organization'), organization)) };
  const memberships = { create: jest.fn(async () => (order.push('membership'), { id: 'm1' })) };
  const hasher = { hash: jest.fn(async (p: string) => `hash:${p}`) };
  const verification = {
    issue: jest.fn(async () => (order.push('token'), 'outbox-1')),
    deliver: jest.fn(async () => order.push('deliver')),
  };
  const hooks = new RegistrationHooks();
  // Los dos hooks que el registro exige (Billing y Files) se registran por defecto en cada prueba.
  hooks.register('demo-subscription', async () => void order.push('demo-subscription'));
  hooks.register('personal-drive', async () => void order.push('personal-drive'));
  const uow = { run: jest.fn((work: (tx: unknown) => unknown) => work('tx')) };

  const service = new RegistrationService(
    uow as never,
    users as never,
    organizations as never,
    memberships as never,
    hasher as never,
    hooks,
    verification as never,
  );
  return { service, order, users, organizations, memberships, hasher, verification, hooks, uow };
};

describe('RegistrationService.register (sin base de datos: puertos simulados)', () => {
  it('crea usuario, organización cloud y membresía tenant_admin dentro de una transacción', async () => {
    const t = build();
    const result = await t.service.register(DTO);

    expect(t.uow.run).toHaveBeenCalledTimes(1);
    expect(t.users.findByEmail).toHaveBeenCalledWith('ana@test.com', 'tx'); // correo normalizado, dentro de la transacción
    expect(t.users.create).toHaveBeenCalledWith('tx', expect.objectContaining({ passwordHash: 'hash:Password123' }));
    expect(t.organizations.create).toHaveBeenCalledWith('tx', {
      name: 'Empresa SA',
      deploymentModel: INITIAL_DEPLOYMENT_MODEL,
    });
    expect(t.memberships.create).toHaveBeenCalledWith('tx', {
      userId: 'u1',
      organizationId: 'o1',
      role: Role.TENANT_ADMIN,
    });
    expect(result).toEqual({ userId: 'u1', organizationId: 'o1', role: Role.TENANT_ADMIN, verificationRequired: true });
  });

  it('los hooks van después de la membresía, antes del token, y reciben la transacción', async () => {
    const t = build();
    const seen: unknown[] = [];
    t.hooks.register('prueba', async (ctx) => {
      t.order.push('prueba');
      seen.push(ctx);
    });

    await t.service.register(DTO);

    expect(seen).toEqual([{ manager: 'tx', userId: 'u1', organizationId: 'o1' }]);
    expect(t.order).toEqual([
      'user',
      'organization',
      'membership',
      'demo-subscription',
      'personal-drive',
      'prueba',
      'token',
      'deliver',
    ]);
    expect(t.verification.deliver).toHaveBeenCalledWith('outbox-1');
  });

  it('si un hook falla, el registro falla, no se emite el token y no se envía correo', async () => {
    const t = build();
    t.hooks.register('billing-que-falla', async () => {
      throw new Error('cuota no creada');
    });

    let error: unknown;
    try {
      await t.service.register(DTO);
    } catch (err) {
      error = err;
    }

    expect((error as Error).message).toBe('cuota no creada');
    expect(t.verification.issue).not.toHaveBeenCalled();
    expect(t.verification.deliver).not.toHaveBeenCalled();
    // El rollback real lo hace dataSource.transaction al propagarse la excepción; aquí se verifica que IAM no la traga.
  });

  it('un segundo hook no se ejecuta si el primero falla', async () => {
    const t = build();
    const second = jest.fn();
    t.hooks.register('primero', async () => {
      throw new Error('falló');
    });
    t.hooks.register('segundo', second);

    let message = 'NO_ERROR';
    try {
      await t.service.register(DTO);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe('falló');
    expect(second).not.toHaveBeenCalled();
  });

  it('correo ya registrado: EMAIL_ALREADY_REGISTERED y no se crea nada más', async () => {
    const t = build();
    t.users.findByEmail.mockResolvedValue({ id: 'existente' });

    expect(await codeOf(t.service.register(DTO))).toBe('EMAIL_ALREADY_REGISTERED');
    expect(t.users.create).not.toHaveBeenCalled();
    expect(t.organizations.create).not.toHaveBeenCalled();
    expect(t.verification.deliver).not.toHaveBeenCalled();
  });

  it('carrera entre dos registros (violación UNIQUE 23505): también EMAIL_ALREADY_REGISTERED', async () => {
    const t = build();
    t.users.create.mockRejectedValue({ code: '23505' });

    expect(await codeOf(t.service.register(DTO))).toBe('EMAIL_ALREADY_REGISTERED');
    expect(t.verification.deliver).not.toHaveBeenCalled();
  });

  it('si falta el rol en iam.role el error se propaga y no se envía correo', async () => {
    const t = build();
    t.memberships.create.mockRejectedValue(new Error('El catálogo iam.role no contiene el rol "tenant_admin"'));

    let error: unknown;
    try {
      await t.service.register(DTO);
    } catch (err) {
      error = err;
    }
    expect((error as Error).message).toContain('iam.role');
    expect(t.verification.deliver).not.toHaveBeenCalled();
  });
});

describe('RegistrationHooks (hooks requeridos)', () => {
  const ctx = { manager: 'tx', userId: 'u1', organizationId: 'o1' } as never;

  it('si falta el hook de Files (personal-drive), el registro se rechaza en lugar de confirmarse sin Drive', async () => {
    const hooks = new RegistrationHooks();
    hooks.register('demo-subscription', async () => undefined);

    await expect(hooks.run(ctx)).rejects.toThrow('Faltan hooks de registro requeridos: personal-drive');
  });

  it('si faltan todos los hooks requeridos, los lista todos', async () => {
    const hooks = new RegistrationHooks();

    await expect(hooks.run(ctx)).rejects.toThrow('demo-subscription, personal-drive');
  });
});
