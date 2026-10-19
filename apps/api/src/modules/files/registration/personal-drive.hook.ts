import { Injectable, OnModuleInit } from '@nestjs/common';
import { RegistrationHooks } from '../../iam/registration-hooks';
import { FilesService } from '../files.service';

/**
 * Hook `personal-drive` que exige el registro de IAM: delega en Files la creación del Drive
 * `Mi espacio` y su carpeta raíz `Archivos`.
 *
 * Recibe el EntityManager de IAM: el Drive, la carpeta raíz, la cuota, el destino y la
 * referencia de cifrado se confirman o revierten como parte del mismo registro.
 */
@Injectable()
export class PersonalDriveHook implements OnModuleInit {
  constructor(
    private readonly hooks: RegistrationHooks,
    private readonly files: FilesService,
  ) {}

  onModuleInit(): void {
    this.hooks.register('personal-drive', async ({ manager, userId, organizationId }) => {
      await this.files.getOrCreateUserDrive(organizationId, userId, manager);
    });
  }
}
