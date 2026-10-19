import { Injectable, OnModuleInit } from '@nestjs/common';
import { RegistrationHooks } from '../../iam/registration-hooks';

/** Plan inicial de toda organización nueva (CONTRACTS.md v0.4: Demo, 5 GB, 5 usuarios, sin vencimiento). */
const DEMO_PLAN_NAME = 'Demo';

/**
 * Hook `demo-subscription` que exige el registro de IAM. Escribe con el EntityManager de la transacción
 * del alta, así que la suscripción se confirma o se revierte junto con el usuario y la organización.
 *
 * Usa SQL contra el esquema canónico de `database/migrations` porque las entidades del módulo todavía
 * apuntan al esquema plano anterior (`subscriptions`); cuando Billing se alinee con el contrato, esta
 * consulta se reemplaza por su repositorio sin tocar IAM.
 */
@Injectable()
export class DemoSubscriptionHook implements OnModuleInit {
  constructor(private readonly hooks: RegistrationHooks) {}

  onModuleInit(): void {
    this.hooks.register('demo-subscription', async ({ manager, organizationId }) => {
      const rows: unknown[] = await manager.query(
        `INSERT INTO billing.subscription (organization_id, plan_id, status, start_date, end_date)
         SELECT $1, plan.plan_id, 'active', CURRENT_DATE, NULL
           FROM billing.plan AS plan
          WHERE plan.name = $2
         RETURNING subscription_id`,
        [organizationId, DEMO_PLAN_NAME],
      );

      // Sin plan Demo no hay cuota: el alta debe fallar y revertirse, no quedar sin suscripción.
      if (rows.length === 0) {
        throw new Error(
          `El catálogo billing.plan no contiene el plan "${DEMO_PLAN_NAME}": aplicar las migraciones de datos de referencia`,
        );
      }
    });
  }
}
