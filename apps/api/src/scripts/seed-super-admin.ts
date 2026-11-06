import { Logger } from '@nestjs/common';
import { IsEmail, MaxLength, validateSync } from 'class-validator';
import { PasswordPolicy } from '../modules/iam/dto/password-policy';
import { normalizeEmail } from '../modules/iam/iam.utils';
import type { MembershipRepository, UserRepository } from '../modules/iam/ports/repositories';
import type { RegistrationService } from '../modules/iam/services/registration.service';

export const SUPER_ADMIN_NAME = 'Super Admin';
export const PLATFORM_ORGANIZATION_NAME = 'Nexus Plataforma';

class SuperAdminCredentials {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @PasswordPolicy()
  password!: string;
}

/** Valida SUPER_ADMIN_EMAIL y SUPER_ADMIN_PASSWORD antes de abrir ninguna conexión. */
export function resolveSuperAdminCredentials(env: NodeJS.ProcessEnv): { email: string; password: string } {
  const candidate = Object.assign(new SuperAdminCredentials(), {
    email: (env.SUPER_ADMIN_EMAIL ?? '').trim(),
    password: env.SUPER_ADMIN_PASSWORD ?? '',
  });
  const problems = validateSync(candidate).map((error) => error.property);
  if (problems.length > 0) {
    throw new Error(
      'Defina SUPER_ADMIN_EMAIL (un correo válido) y SUPER_ADMIN_PASSWORD (8 a 128 caracteres, con letras y números).',
    );
  }
  return { email: normalizeEmail(candidate.email), password: candidate.password };
}

export interface SeedSuperAdminDependencies {
  registration: Pick<RegistrationService, 'register'>;
  users: Pick<UserRepository, 'findByEmail'>;
  memberships: Pick<MembershipRepository, 'findActive'>;
  /** Único lugar del sistema que concede is_super_admin: este script, nunca la API. También verifica el correo. */
  grantSuperAdmin: (userId: string) => Promise<void>;
}

export interface SeededSuperAdmin {
  email: string;
  created: boolean;
}

/**
 * Crea la cuenta del dueño de la plataforma con su organización interna "Nexus Plataforma", usando el mismo caso
 * de uso de registro que la API (suscripción, cuota y Drive reales). Es idempotente: si ya existe un Super Admin con
 * ese correo no duplica nada y no cambia su contraseña. Nunca eleva una cuenta de cliente que ya exista.
 */
export async function seedSuperAdmin(
  deps: SeedSuperAdminDependencies,
  credentials: { email: string; password: string },
): Promise<SeededSuperAdmin> {
  const existing = await deps.users.findByEmail(credentials.email);
  if (existing && !existing.isSuperAdmin) {
    throw new Error(
      `${credentials.email} ya existe como cuenta normal. Por seguridad no se eleva automáticamente: use otro correo.`,
    );
  }

  if (!existing) {
    await deps.registration.register({
      fullName: SUPER_ADMIN_NAME,
      email: credentials.email,
      password: credentials.password,
      organizationName: PLATFORM_ORGANIZATION_NAME,
    });
  }

  const user = existing ?? (await deps.users.findByEmail(credentials.email));
  if (!user) throw new Error('No se pudo crear la cuenta del Super Admin.');
  if (!(await deps.memberships.findActive(user.id))) {
    throw new Error(`${credentials.email} es Super Admin pero no tiene una organización activa.`);
  }

  if (!existing) await deps.grantSuperAdmin(user.id);
  return { email: credentials.email, created: !existing };
}

const logger = new Logger('SeedSuperAdmin');

async function main(): Promise<void> {
  // Las importaciones van aquí para que las pruebas del script no carguen la aplicación completa. Importar AppModule
  // ya cargó el .env en process.env: las credenciales se validan después, antes de abrir ninguna conexión.
  const { NestFactory } = await import('@nestjs/core');
  const { DataSource: DataSourceToken } = await import('typeorm');
  const { AppModule } = await import('../app.module');
  const { RegistrationService: RegistrationToken } = await import('../modules/iam/services/registration.service');
  const { MembershipRepository: MembershipToken, UserRepository: UserToken } = await import(
    '../modules/iam/ports/repositories'
  );
  const credentials = resolveSuperAdminCredentials(process.env);
  const app = await NestFactory.createApplicationContext(AppModule, { abortOnError: false, logger: ['error', 'warn'] });
  try {
    const dataSource = app.get(DataSourceToken, { strict: false });
    const seeded = await seedSuperAdmin(
      {
        registration: app.get(RegistrationToken, { strict: false }),
        users: app.get(UserToken, { strict: false }),
        memberships: app.get(MembershipToken, { strict: false }),
        grantSuperAdmin: async (userId) => {
          await dataSource.query('UPDATE iam."user" SET is_super_admin = true, email_verified = true WHERE user_id = $1', [
            userId,
          ]);
        },
      },
      credentials,
    );
    app.useLogger(['log', 'warn', 'error']);
    logger.log(
      seeded.created
        ? `Creado: ${seeded.email} (Super Admin, organización "${PLATFORM_ORGANIZATION_NAME}")`
        : `Ya existía: ${seeded.email}. No se cambió nada.`,
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error(error instanceof Error ? error.message : 'seed:super-admin falló');
    process.exitCode = 1;
  });
}
