import { Injectable, OnModuleInit } from '@nestjs/common';
import { RegistrationHooks } from '../../iam/registration-hooks';

/** Nombres aprobados en CONTRACTS.md v0.4 para el espacio inicial de cada cuenta. */
const PERSONAL_DRIVE_NAME = 'Mi espacio';
const ROOT_FOLDER_NAME = 'Archivos';

/**
 * Hook `personal-drive` que exige el registro de IAM: Drive personal, carpeta raíz y contadores de cuota.
 * Escribe con el EntityManager de la transacción del alta (se confirma o se revierte con la cuenta) y
 * solo toca metadatos en PostgreSQL: no llama a SeaweedFS.
 *
 * Usa SQL contra el esquema canónico de `database/migrations` porque las entidades del módulo todavía
 * apuntan al esquema plano anterior (`folders`); cuando Files se alinee con el contrato, estas consultas
 * se reemplazan por su repositorio sin tocar IAM.
 */
@Injectable()
export class PersonalDriveHook implements OnModuleInit {
  constructor(private readonly hooks: RegistrationHooks) {}

  onModuleInit(): void {
    this.hooks.register('personal-drive', async ({ manager, userId, organizationId }) => {
      const [drive] = (await manager.query(
        `INSERT INTO files.drive (organization_id, type, owner_user_id, name)
         VALUES ($1, 'personal', $2, $3)
         RETURNING drive_id`,
        [organizationId, userId, PERSONAL_DRIVE_NAME],
      )) as { drive_id: string }[];

      await manager.query(
        `INSERT INTO files.folder (organization_id, drive_id, parent_folder_id, name, created_by)
         VALUES ($1, $2, NULL, $3, $4)`,
        [organizationId, drive.drive_id, ROOT_FOLDER_NAME, userId],
      );

      // Contadores de cuota del tenant en cero: el uso se descuenta contra la suscripción Demo.
      await manager.query(
        `INSERT INTO files.tenant_quota (organization_id, confirmed_usage_bytes, active_reservations_bytes)
         VALUES ($1, 0, 0)
         ON CONFLICT (organization_id) DO NOTHING`,
        [organizationId],
      );
    });
  }
}
