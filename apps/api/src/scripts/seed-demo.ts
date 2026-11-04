import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { FilesService } from '../modules/files/files.service';
import { MembershipRepository, UserRepository } from '../modules/iam/ports/repositories';
import { PasswordHasher } from '../modules/iam/ports/security';
import { UnitOfWork } from '../modules/iam/ports/transaction';
import { MembersService } from '../modules/iam/services/members.service';
import { RegistrationService } from '../modules/iam/services/registration.service';
import { resolveDemoPassword, seedDemoUsers } from './seed-demo-users';

const logger = new Logger('SeedDemo');

async function main(): Promise<void> {
  // Importar AppModule ya cargó el .env en process.env; se valida antes de abrir ninguna conexión.
  const password = resolveDemoPassword(process.env);
  const app = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: ['error', 'warn'],
  });
  try {
    const files = app.get(FilesService, { strict: false });
    const seeded = await seedDemoUsers(
      {
        registration: app.get(RegistrationService, { strict: false }),
        members: app.get(MembersService, { strict: false }),
        users: app.get(UserRepository, { strict: false }),
        memberships: app.get(MembershipRepository, { strict: false }),
        hasher: app.get(PasswordHasher, { strict: false }),
        uow: app.get(UnitOfWork, { strict: false }),
        ensurePersonalDrive: (organizationId, userId) => files.getOrCreateUserDrive(organizationId, userId),
      },
      password,
    );
    app.useLogger(['log', 'warn', 'error']); // el arranque de Nest se silenció; el resumen sí debe verse
    for (const user of seeded) {
      logger.log(`${user.created ? 'Creado' : 'Actualizado'}: ${user.email} (${user.role})`);
    }
    logger.log('Contraseña de ambas cuentas: el valor de DEMO_PASSWORD.');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : 'seed:demo falló');
  process.exitCode = 1;
});
