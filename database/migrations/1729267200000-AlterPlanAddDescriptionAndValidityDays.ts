import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migración Canónica TypeORM: Alteración, Normalización e Índices de Billing
 *
 * Ubicación: database/migrations/ (raíz del repositorio)
 * Cumple con: CONTRACTS.md v0.3, CONTRIBUTING.md y ADR-005.
 *
 * Acciones:
 * 1. Agrega description y validity_days a plans.
 * 2. Agrega simulated a subscriptions.
 * 3. Normaliza suscripciones históricas (simulated a active/cancelled determinista).
 * 4. Crea índice único condicional (parcial) uq_active_org_subscription.
 * 5. Siembra/actualiza el catálogo canónico con capacidades decimales exactas.
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

    // 6. Sembrar / Actualizar catálogo oficial aprobado con valores decimales exactos
    await queryRunner.query(`
      INSERT INTO "plans" ("id", "name", "description", "price_cents", "storage_limit_bytes", "max_members", "validity_days", "storage_location", "active", "created_at")
      VALUES
        (gen_random_uuid(), 'Demo', 'Prueba el espacio de trabajo de Nexus con capacidad para una organización pequeña.', 0, 5000000000, 5, NULL, 'cloud', true, NOW()),
        (gen_random_uuid(), 'Team', 'Almacenamiento seguro para equipos pequeños que comparten archivos de trabajo.', 1999, 100000000000, 10, 30, 'cloud', true, NOW()),
        (gen_random_uuid(), 'Business', 'Más capacidad y espacio para organizaciones en crecimiento.', 5999, 500000000000, 30, 30, 'cloud', true, NOW()),
        (gen_random_uuid(), 'Enterprise', 'Capacidad ampliada para organizaciones con mayor volumen.', 14999, 2000000000000, 100, 30, 'cloud', true, NOW())
      ON CONFLICT ("name") DO UPDATE SET
        "description" = EXCLUDED."description",
        "price_cents" = EXCLUDED."price_cents",
        "storage_limit_bytes" = EXCLUDED."storage_limit_bytes",
        "max_members" = EXCLUDED."max_members",
        "validity_days" = EXCLUDED."validity_days",
        "active" = true;
    `);
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
