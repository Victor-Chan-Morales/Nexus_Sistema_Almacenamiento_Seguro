import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Un decimal de GB del plan, igual que Billing (billing.plan guarda GB decimales). */
const BYTES_PER_GB = 1_000_000_000;

export interface PlatformOrganizationItem {
  id: string;
  name: string;
  status: string;
  deploymentModel: string;
  /** null si la organización no tiene suscripción vigente. */
  planName: string | null;
  usedBytes: number;
  /** null si no hay suscripción vigente. */
  storageLimitBytes: number | null;
  memberCount: number;
  createdAt: string;
}

export interface PlatformOrganizationsPage {
  items: PlatformOrganizationItem[];
  total: number;
}

export interface PlatformMetrics {
  organizations: { active: number; suspended: number; cancelled: number };
  activeUsers: number;
  usedBytes: number;
  subscriptionsByPlan: Array<{ planName: string; count: number }>;
}

/**
 * Una sola consulta con agregados, sin N+1 (SPEC-501). Columnas explícitas: no hay SELECT *, y no se toca
 * iam."user" ni files.file, así que ningún correo, nombre de persona ni nombre de archivo puede salir.
 * Suscripción vigente = status active y sin end_date o con end_date posterior a hoy (UTC), como Billing; el índice
 * parcial uq_subscription_one_active_per_organization garantiza una sola, así que el JOIN no duplica filas.
 */
const ORGANIZATIONS_SQL = `
  SELECT o.organization_id                                   AS id,
         o.name                                              AS name,
         o.status                                            AS status,
         o.deployment_model                                  AS "deploymentModel",
         p.name                                              AS "planName",
         COALESCE(q.confirmed_usage_bytes, 0)                AS "usedBytes",
         p.storage_limit_gb::bigint * ${BYTES_PER_GB}        AS "storageLimitBytes",
         (SELECT COUNT(*) FROM iam.membership m
           WHERE m.organization_id = o.organization_id AND m.status = 'active') AS "memberCount",
         o.created_at                                        AS "createdAt",
         (SELECT COUNT(*) FROM admin.organization)           AS total
    FROM admin.organization o
    LEFT JOIN billing.subscription s
           ON s.organization_id = o.organization_id
          AND s.status = 'active'
          AND (s.end_date IS NULL OR s.end_date > (now() AT TIME ZONE 'UTC')::date)
    LEFT JOIN billing.plan p ON p.plan_id = s.plan_id
    LEFT JOIN files.tenant_quota q ON q.organization_id = o.organization_id
   ORDER BY o.created_at DESC, o.organization_id
   LIMIT $1 OFFSET $2`;

const TOTALS_SQL = `
  SELECT o.active, o.suspended, o.cancelled, u.active_users, q.used_bytes
    FROM (SELECT COUNT(*) FILTER (WHERE status = 'active')    AS active,
                 COUNT(*) FILTER (WHERE status = 'suspended') AS suspended,
                 COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
            FROM admin.organization) o
   CROSS JOIN (SELECT COUNT(*) AS active_users FROM iam."user" WHERE status = 'active') u
   CROSS JOIN (SELECT COALESCE(SUM(confirmed_usage_bytes), 0) AS used_bytes FROM files.tenant_quota) q`;

const BY_PLAN_SQL = `
  SELECT p.name AS "planName", COUNT(*) AS count
    FROM billing.subscription s
    JOIN billing.plan p ON p.plan_id = s.plan_id
   WHERE s.status = 'active'
     AND (s.end_date IS NULL OR s.end_date > (now() AT TIME ZONE 'UTC')::date)
   GROUP BY p.name
   ORDER BY COUNT(*) DESC, p.name`;

interface OrganizationRow {
  id: string;
  name: string;
  status: string;
  deploymentModel: string;
  planName: string | null;
  usedBytes: string | number;
  storageLimitBytes: string | number | null;
  memberCount: string | number;
  createdAt: Date;
  total: string | number;
}

/** Consultas de solo lectura para el dueño de la plataforma (SPEC-501). Sin auditoría: las lecturas no se registran. */
@Injectable()
export class PlatformAdminService {
  constructor(private readonly dataSource: DataSource) {}

  async listOrganizations(limit: number, offset: number): Promise<PlatformOrganizationsPage> {
    const rows = (await this.dataSource.query(ORGANIZATIONS_SQL, [limit, offset])) as OrganizationRow[];

    // Con una página vacía la consulta no devuelve el total: solo en ese caso se cuenta aparte.
    const total =
      rows.length > 0
        ? Number(rows[0].total)
        : Number(((await this.dataSource.query('SELECT COUNT(*) AS total FROM admin.organization')) as Array<{ total: string }>)[0].total);

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        deploymentModel: row.deploymentModel,
        planName: row.planName,
        usedBytes: Number(row.usedBytes),
        storageLimitBytes: row.storageLimitBytes === null ? null : Number(row.storageLimitBytes),
        memberCount: Number(row.memberCount),
        createdAt: new Date(row.createdAt).toISOString(),
      })),
      total,
    };
  }

  async getMetrics(): Promise<PlatformMetrics> {
    const [totals, byPlan] = await Promise.all([
      this.dataSource.query(TOTALS_SQL) as Promise<
        Array<{ active: string; suspended: string; cancelled: string; active_users: string; used_bytes: string }>
      >,
      this.dataSource.query(BY_PLAN_SQL) as Promise<Array<{ planName: string; count: string }>>,
    ]);
    const row = totals[0];
    return {
      organizations: {
        active: Number(row.active),
        suspended: Number(row.suspended),
        cancelled: Number(row.cancelled),
      },
      activeUsers: Number(row.active_users),
      usedBytes: Number(row.used_bytes),
      subscriptionsByPlan: byPlan.map((plan) => ({ planName: plan.planName, count: Number(plan.count) })),
    };
  }
}
