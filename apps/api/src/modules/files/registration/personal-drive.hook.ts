import { Injectable, OnModuleInit } from '@nestjs/common';
import { RegistrationHooks } from '../../iam/registration-hooks';
import { FilesService } from '../files.service';

/**
 * Hook `personal-drive` que exige el registro de IAM: delega en Files la creación del Drive
 * `Mi espacio` y su carpeta raíz `Archivos`.
 *
 * Pendiente de este corte: Files aún provisiona con sus propios repositorios, así que esta
 * escritura no viaja en la transacción del alta. La operación es idempotente y Files también
 * la resuelve al primer listado, de modo que la cuenta nunca queda sin espacio; cuando Files
 * acepte un EntityManager, el hook se lo pasará como ya hace Billing.
 */
@Injectable()
export class PersonalDriveHook implements OnModuleInit {
  constructor(
    private readonly hooks: RegistrationHooks,
    private readonly files: FilesService,
  ) {}

  onModuleInit(): void {
    this.hooks.register('personal-drive', async ({ userId, organizationId }) => {
      await this.files.getOrCreateUserDrive(organizationId, userId);
    });
  }
}
