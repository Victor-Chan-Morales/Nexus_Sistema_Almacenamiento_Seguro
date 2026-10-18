import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migración TypeORM: Alteración de tabla plans y subscriptions
 *
 * Agrega description y validity_days a plans.
 * Asegura simulated y status en subscriptions.
 * Crea índice único parcial para garantizar a lo sumo una suscripción activa por tenant.
 * Sincroniza el catálogo aprobado oficial.
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

    // 3. Normalizar registros existentes con status histórico 'simulated'
    await queryRunner.query(`
      UPDATE "subscriptions" 
      SET "status" = 'active', "simulated" = true 
      WHERE "status" = 'simulated';
    `);

    // 4. Crear índice único condicional (parcial)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_active_org_subscription" 
      ON "subscriptions" ("organization_id") 
      WHERE "status" = 'active';
    `);

    // 5. Sembrar/Actualizar catálogo oficial aprobado
    await queryRunner.query(`
      INSERT INTO "plans" ("id", "name", "description", "price_cents", "storage_limit_bytes", "max_members", "validity_days", "storage_location", "active", "created_at")
      VALUES
        (gen_random_uuid(), 'Plan Demo', 'Prueba el espacio de trabajo de Nexus con capacidad para una organización pequeña.', 0, 5368709120, 5, NULL, 'cloud', true, NOW()),
        (gen_random_uuid(), 'Plan Team', 'Almacenamiento seguro para equipos pequeños que comparten archivos de trabajo.', 1999, 107374182400, 10, 30, 'cloud', true, NOW()),
        (gen_random_uuid(), 'Plan Business', 'Más capacidad y espacio para organizaciones en crecimiento.', 5999, 536870912000, 30, 30, 'cloud', true, NOW()),
        (gen_random_uuid(), 'Plan Enterprise', 'Capacidad ampliada para organizaciones con mayor volumen.', 14999, 2147483648000, 100, 30, 'cloud', true, NOW())
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
