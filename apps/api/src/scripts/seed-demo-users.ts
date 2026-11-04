import { validateSync } from 'class-validator';
import { Role } from '../modules/iam/domain/enums';
import { PasswordPolicy } from '../modules/iam/dto/password-policy';
import { normalizeEmail } from '../modules/iam/iam.utils';
import { AuthUser } from '../modules/iam/interfaces/auth-user.interface';
import { MembershipRepository, UserRepository } from '../modules/iam/ports/repositories';
import { PasswordHasher } from '../modules/iam/ports/security';
import { UnitOfWork } from '../modules/iam/ports/transaction';
import { MembersService } from '../modules/iam/services/members.service';
import { RegistrationService } from '../modules/iam/services/registration.service';

export const DEMO_ADMIN = {
  email: 'admin@demo.test',
  fullName: 'Admin Demo',
  organizationName: 'Organización Demo',
};
export const DEMO_COLLABORATOR = { email: 'colaborador@demo.test', fullName: 'Colaborador Demo' };

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

class DemoPassword {
  @PasswordPolicy()
  value!: string;
}

/**
 * Valida el entorno antes de conectarse: nunca corre en producción ni contra una base que no sea local,
 * porque crea cuentas con una contraseña compartida. Devuelve la contraseña ya validada.
 */
export function resolveDemoPassword(env: NodeJS.ProcessEnv): string {
  if (env.NODE_ENV === 'production') {
    throw new Error('seed:demo no se ejecuta con NODE_ENV=production.');
  }
  const host = env.POSTGRES_HOST ?? 'localhost';
  if (!LOCAL_DATABASE_HOSTS.has(host)) {
    throw new Error(`seed:demo solo se ejecuta contra una base local; POSTGRES_HOST es "${host}".`);
  }
  const candidate = Object.assign(new DemoPassword(), { value: env.DEMO_PASSWORD ?? '' });
  if (validateSync(candidate).length > 0) {
    throw new Error('Defina DEMO_PASSWORD: entre 8 y 128 caracteres, con letras y números.');
  }
  return candidate.value;
}

export interface SeedDemoDependencies {
  registration: Pick<RegistrationService, 'register'>;
  members: Pick<MembersService, 'addMember'>;
  users: Pick<UserRepository, 'findByEmail' | 'setPasswordAndVerifyEmail'>;
  memberships: Pick<MembershipRepository, 'findActive'>;
  hasher: Pick<PasswordHasher, 'hash'>;
  uow: Pick<UnitOfWork, 'run'>;
  ensurePersonalDrive: (organizationId: string, userId: string) => Promise<unknown>;
}

export interface SeededDemoUser {
  email: string;
  role: Role;
  created: boolean;
}

/**
 * Crea las cuentas con los mismos casos de uso que la API, para que tengan suscripción, cuota, Drive y llave
 * reales. Es idempotente: al repetirse no duplica nada y deja vigente la DEMO_PASSWORD actual.
 */
export async function seedDemoUsers(deps: SeedDemoDependencies, password: string): Promise<SeededDemoUser[]> {
  const adminEmail = normalizeEmail(DEMO_ADMIN.email);
  const collaboratorEmail = normalizeEmail(DEMO_COLLABORATOR.email);

  const existingAdmin = await deps.users.findByEmail(adminEmail);
  if (!existingAdmin) {
    await deps.registration.register({ ...DEMO_ADMIN, email: adminEmail, password });
  }
  const admin = existingAdmin ?? (await deps.users.findByEmail(adminEmail));
  const adminMembership = await deps.memberships.findActive(admin.id);
  if (!adminMembership || adminMembership.role !== Role.TENANT_ADMIN) {
    throw new Error(`${adminEmail} ya existe, pero no administra ninguna organización activa.`);
  }
  const organizationId = adminMembership.organizationId;

  const existingCollaborator = await deps.users.findByEmail(collaboratorEmail);
  if (!existingCollaborator) {
    const actor = { userId: admin.id, organizationId, role: Role.TENANT_ADMIN } as AuthUser;
    await deps.members.addMember(actor, {
      ...DEMO_COLLABORATOR,
      email: collaboratorEmail,
      role: Role.COLABORADOR,
    });
  }
  const collaborator = existingCollaborator ?? (await deps.users.findByEmail(collaboratorEmail));
  const collaboratorMembership = await deps.memberships.findActive(collaborator.id, organizationId);
  if (!collaboratorMembership) {
    throw new Error(`${collaboratorEmail} ya existe, pero no pertenece a la organización de ${adminEmail}.`);
  }

  // Altas nuevas o repetidas terminan igual: correo verificado y una sola contraseña conocida.
  const passwordHash = await deps.hasher.hash(password);
  await deps.uow.run(async (tx) => {
    await deps.users.setPasswordAndVerifyEmail(tx, admin.id, passwordHash);
    await deps.users.setPasswordAndVerifyEmail(tx, collaborator.id, passwordHash);
  });

  // Registro crea el Drive del administrador; el de un miembro se crea en su primer acceso a Archivos.
  await deps.ensurePersonalDrive(organizationId, collaborator.id);

  return [
    { email: adminEmail, role: Role.TENANT_ADMIN, created: !existingAdmin },
    { email: collaboratorEmail, role: Role.COLABORADOR, created: !existingCollaborator },
  ];
}
