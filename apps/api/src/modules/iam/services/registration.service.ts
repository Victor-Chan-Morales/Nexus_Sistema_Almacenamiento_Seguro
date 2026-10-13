import { Injectable } from '@nestjs/common';
import { INITIAL_DEPLOYMENT_MODEL, Role } from '../domain/enums';
import { RegisterDto } from '../dto/register.dto';
import { Organization } from '../entities/organization.entity';
import { User } from '../entities/user.entity';
import { IamErrors } from '../iam.errors';
import { isUniqueViolation, normalizeEmail } from '../iam.utils';
import { RegisterResponse } from '../interfaces/auth-user.interface';
import {
  MembershipRepository,
  OrganizationRepository,
  UserRepository,
} from '../ports/repositories';
import { PasswordHasher } from '../ports/security';
import { UnitOfWork } from '../ports/transaction';
import { RegistrationHooks } from '../registration-hooks';
import { EmailVerificationService } from './email-verification.service';

/** Caso de uso de registro: usuario + organización + membresía (+ hooks de otros módulos) en una transacción. */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly users: UserRepository,
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly hasher: PasswordHasher,
    private readonly hooks: RegistrationHooks,
    private readonly verification: EmailVerificationService,
  ) {}

  async register(dto: RegisterDto): Promise<RegisterResponse> {
    const email = normalizeEmail(dto.email);
    const passwordHash = await this.hasher.hash(dto.password);

    let created: { user: User; organization: Organization; rawToken: string };
    try {
      created = await this.uow.run(async (tx) => {
        if (await this.users.findByEmail(email, tx)) throw IamErrors.emailTaken();

        const user = await this.users.create(tx, { email, fullName: dto.fullName, passwordHash });
        const organization = await this.organizations.create(tx, {
          name: dto.organizationName,
          deploymentModel: INITIAL_DEPLOYMENT_MODEL,
        });
        await this.memberships.create(tx, {
          userId: user.id,
          organizationId: organization.id,
          role: Role.TENANT_ADMIN,
        });

        // Suscripción demo + cuota (Billing) y Drive personal "Mi espacio" (Files):
        // se confirman o revierten junto con el resto del registro.
        await this.hooks.run({ manager: tx, userId: user.id, organizationId: organization.id });

        const rawToken = await this.verification.issue(tx, user.id);
        return { user, organization, rawToken };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw IamErrors.emailTaken(); // carrera entre dos registros simultáneos
      throw err;
    }

    await this.verification.deliver(created.user, created.rawToken); // tras el commit

    return {
      userId: created.user.id,
      organizationId: created.organization.id,
      role: Role.TENANT_ADMIN,
      verificationRequired: true,
    };
  }
}
