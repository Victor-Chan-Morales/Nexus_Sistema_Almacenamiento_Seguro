import { NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { BillingService } from '../billing/billing.service';
import { OrgStatus, Role } from '../iam/domain/enums';
import { Organization } from '../iam/entities/organization.entity';
import { User } from '../iam/entities/user.entity';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { OrganizationRepository, UserRepository } from '../iam/ports/repositories';
import { PasswordHasher } from '../iam/ports/security';
import { TransactionContext, UnitOfWork } from '../iam/ports/transaction';
import { SessionService } from '../iam/services/session.service';
import { OrganizationClosureService } from './organization-closure.service';

describe('OrganizationClosureService (SPEC-114)', () => {
  let service: OrganizationClosureService;
  let organizations: jest.Mocked<OrganizationRepository>;
  let billing: jest.Mocked<BillingService>;
  let sessions: jest.Mocked<SessionService>;
  let users: jest.Mocked<UserRepository>;
  let hasher: jest.Mocked<PasswordHasher>;
  let uow: UnitOfWork;
  let audit: jest.Mocked<AuditService>;

  const actor: AuthUser = {
    userId: 'user-uuid-1',
    organizationId: 'org-uuid-1',
    organizationName: 'Empresa Test',
    email: 'admin@prueba.test',
    fullName: 'Admin de Prueba',
    role: Role.TENANT_ADMIN,
    isSuperAdmin: false,
  };

  const fakeUser: Partial<User> = {
    id: 'user-uuid-1',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$fakehash',
  };

  const fakeOrg: Partial<Organization> = {
    id: 'org-uuid-1',
    name: 'Empresa Test',
    status: OrgStatus.ACTIVE,
  };

  beforeEach(() => {
    organizations = {
      create: jest.fn(),
      lockById: jest.fn(),
      findByIdForUpdate: jest.fn().mockResolvedValue(fakeOrg as Organization),
      setStatus: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OrganizationRepository>;

    billing = {
      cancelActive: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<BillingService>;

    sessions = {
      revokeAllOfOrganization: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SessionService>;

    users = {
      findById: jest.fn().mockResolvedValue(fakeUser as User),
      findByEmail: jest.fn(),
      findByEmailForUpdate: jest.fn(),
      create: jest.fn(),
      markEmailVerified: jest.fn(),
      setPasswordAndVerifyEmail: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;

    hasher = {
      hash: jest.fn(),
      verify: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<PasswordHasher>;

    // Unit of work que ejecuta la función del callback pasando un contexto dummy
    const dummyTx = {} as TransactionContext;
    uow = {
      run: jest.fn().mockImplementation((fn: (tx: TransactionContext) => Promise<unknown>) => fn(dummyTx)),
    } as UnitOfWork;

    audit = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditService>;

    service = new OrganizationClosureService(
      organizations,
      billing,
      sessions,
      users,
      hasher,
      uow,
      audit,
    );
  });

  it('cierra exitosamente la empresa cuando los datos y contraseña son correctos', async () => {
    const result = await service.close(actor, {
      organizationName: 'Empresa Test',
      password: 'correct-password',
    });

    expect(result).toEqual({ closed: true });
    expect(hasher.verify).toHaveBeenCalledWith(fakeUser.passwordHash, 'correct-password');
    expect(organizations.findByIdForUpdate).toHaveBeenCalledWith('org-uuid-1', expect.anything());
    expect(organizations.setStatus).toHaveBeenCalledWith(expect.anything(), 'org-uuid-1', OrgStatus.CANCELLED);
    expect(billing.cancelActive).toHaveBeenCalledWith('org-uuid-1', expect.anything());
    expect(sessions.revokeAllOfOrganization).toHaveBeenCalledWith(expect.anything(), 'org-uuid-1');
    expect(audit.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-uuid-1',
      actorId: 'user-uuid-1',
      action: AuditAction.ORGANIZATION_CLOSED,
      resourceType: AuditResource.ORGANIZATION,
    }));
  });

  it('lanza UnauthorizedException (INVALID_CREDENTIALS) si la contraseña no coincide', async () => {
    hasher.verify.mockResolvedValue(false);

    await expect(
      service.close(actor, {
        organizationName: 'Empresa Test',
        password: 'wrong-password',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(uow.run).not.toHaveBeenCalled();
    expect(organizations.setStatus).not.toHaveBeenCalled();
    expect(billing.cancelActive).not.toHaveBeenCalled();
  });

  it('lanza UnprocessableEntityException (ORGANIZATION_NAME_MISMATCH) si el nombre no coincide', async () => {
    await expect(
      service.close(actor, {
        organizationName: 'Nombre Equivocado',
        password: 'correct-password',
      }),
    ).rejects.toThrow(UnprocessableEntityException);

    expect(organizations.setStatus).not.toHaveBeenCalled();
    expect(billing.cancelActive).not.toHaveBeenCalled();
    expect(sessions.revokeAllOfOrganization).not.toHaveBeenCalled();
  });

  it('lanza NotFoundException si la organización no existe', async () => {
    organizations.findByIdForUpdate.mockResolvedValue(null);

    await expect(
      service.close(actor, {
        organizationName: 'Empresa Test',
        password: 'correct-password',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('si cancelActive falla, propaga el error y no registra auditoría', async () => {
    billing.cancelActive.mockRejectedValue(new Error('db caída'));

    await expect(
      service.close(actor, {
        organizationName: 'Empresa Test',
        password: 'correct-password',
      }),
    ).rejects.toThrow('db caída');

    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('si la revocación de sesiones falla, propaga el error y no registra auditoría', async () => {
    sessions.revokeAllOfOrganization.mockRejectedValue(new Error('revocación fallida'));

    await expect(
      service.close(actor, {
        organizationName: 'Empresa Test',
        password: 'correct-password',
      }),
    ).rejects.toThrow('revocación fallida');

    expect(audit.logEvent).not.toHaveBeenCalled();
  });

  it('si la auditoría falla después del commit, el cierre sigue siendo exitoso', async () => {
    audit.logEvent.mockRejectedValue(new Error('outbox caído'));

    const result = await service.close(actor, {
      organizationName: 'Empresa Test',
      password: 'correct-password',
    });

    expect(result).toEqual({ closed: true });
  });
});
