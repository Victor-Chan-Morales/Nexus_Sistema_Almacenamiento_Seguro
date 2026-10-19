import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migración Canónica TypeORM: Alteración, Normalización e Índices de Billing
 *
 * Ubicación: apps/api/src/migrations/ — se ejecuta con `npm run migration:run`.
 * `database/migrations/` en la raíz está reservada a las migraciones SQL canónicas de dbmate, que
 * describen el esquema MER v3 (billing.plan). Estas entidades usan otro esquema (plans), así que
 * consolidar ambos queda a cargo del integrador. Ver SESSION_LOG.md.
 * Cumple con: CONTRACTS.md v0.4 y ADR-005.
 *
 * Acciones:
 * 1. Agrega description y validity_days a plans.
 * 2. Agrega simulated a subscriptions.
 * 3. Normaliza suscripciones históricas (simulated a active/cancelled determinista).
 * 4. Crea índice único condicional (parcial) uq_active_org_subscription.
 * 5. Renombra los planes legados a los nombres canónicos de CONTRACTS.md.
 *
 * No siembra el catálogo: los valores viven solo en BillingService.seedDefaultPlans().
 */
export class AlterPlanAddDescriptionAndValidityDays1729267200000 implements MigrationInterface {
  name = 'AlterPlanAddDescriptionAndValidityDays1729267200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Modificar tabla plans
    await queryRunner.query(`
      ALTER TABLE "plans" 
      ADD COLUMN IF NOT EXISTS "description" text,
      ADD COLUMN IF NOT EXISTS "validity_days" integer DEFAULT NULL;
    `);

    // 2. Modificar tabla subscriptions
    await queryRunner.query(`
      ALTER TABLE "subscriptions" 
      ADD COLUMN IF NOT EXISTS "simulated" boolean NOT NULL DEFAULT true;
    `);

    // 3. Normalización de Datos:
    // Antes de aplicar el índice único parcial, limpiar y normalizar la tabla
    // pasando de múltiples registros 'simulated' o 'active' a un único registro
    // determinista 'active' por organización (el más reciente), marcando los anteriores como 'cancelled'.
    await queryRunner.query(`
      WITH ranked_subs AS (
        SELECT id, organization_id, status,
               ROW_NUMBER() OVER (
                 PARTITION BY organization_id
                 ORDER BY created_at DESC, id DESC
               ) as rn
        FROM "subscriptions"
        WHERE status IN ('active', 'simulated')
      )
      UPDATE "subscriptions" s
      SET status = CASE WHEN r.rn = 1 THEN 'active' ELSE 'cancelled' END,
          simulated = true
      FROM ranked_subs r
      WHERE s.id = r.id;
    `);

    // 4. Crear índice único condicional (parcial) garantizando a lo sumo una suscripción activa por tenant
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_active_org_subscription" 
      ON "subscriptions" ("organization_id") 
      WHERE "status" = 'active';
    `);

    // 5. Normalizar nombres legados del catálogo a los nombres canónicos de CONTRACTS.md
    await queryRunner.query(`
      UPDATE "plans" SET name = 'Demo' WHERE name = 'Plan Demo';
      UPDATE "plans" SET name = 'Team' WHERE name = 'Plan Team';
      UPDATE "plans" SET name = 'Business' WHERE name = 'Plan Business';
      UPDATE "plans" SET name = 'Enterprise' WHERE name = 'Plan Enterprise';
    `);

    // El catálogo NO se siembra aquí: su única fuente son los valores de
    // BillingService.seedDefaultPlans(), que se aplican de forma idempotente al arrancar la API.
    // Así los importes y capacidades no pueden divergir entre migración y código.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_active_org_subscription";`);
    await queryRunner.query(`
      ALTER TABLE "plans" 
      DROP COLUMN IF EXISTS "validity_days",
      DROP COLUMN IF EXISTS "description";
    `);
    await queryRunner.query(`
      ALTER TABLE "subscriptions" 
      DROP COLUMN IF EXISTS "simulated";
    `);
  }
}
