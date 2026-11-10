import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditEventInput, AuditResource } from '../audit/audit.types';
import { BillingService, PlanChanges } from '../billing/billing.service';
import { priceUsd } from '../billing/billing.utils';
import { Plan } from '../billing/entities/plan.entity';
import { FilesService } from '../files/files.service';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { OrganizationRepository } from '../iam/ports/repositories';

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

/** Forma de un plan en PATCH /platform/plans/:id: la misma que cada elemento de GET /plans (SPEC-504). */
export interface PlatformPlanItem {
  id: string;
  name: string;
  description: string;
  priceMonthly: number;
  storageLimitBytes: number;
  userLimit: number;
  validityDays: number | null;
}

/** Cambios parciales de PATCH /platform/plans/:id (SPEC-504). Solo se aplican los campos presentes. */
export interface UpdatePlatformPlanInput {
  priceMonthly?: number;
  storageLimitGb?: number;
  userLimit?: number;
  description?: string;
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

/** Organizaciones con suscripción vigente a un plan, en orden de bloqueo. Mismo criterio de vigencia que ORGANIZATIONS_SQL. */
const PLAN_SUBSCRIBERS_SQL = `
  SELECT s.organization_id AS "organizationId"
    FROM billing.subscription s
   WHERE s.plan_id = $1 AND s.status = 'active'
     AND (s.end_date IS NULL OR s.end_date > (now() AT TIME ZONE 'UTC')::date)
   ORDER BY s.organization_id`;

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

/** Traduce el cuerpo del PATCH a cambios de Billing: precio en centavos y almacenamiento en bytes, nunca en GB. */
function toPlanChanges(input: UpdatePlatformPlanInput): PlanChanges {
  return {
    priceCents: input.priceMonthly === undefined ? undefined : Math.round(input.priceMonthly * 100),
    storageLimitBytes:
      input.storageLimitGb === undefined
        ? undefined
        : (BigInt(input.storageLimitGb) * BigInt(BYTES_PER_GB)).toString(),
    maxMembers: input.userLimit,
    description: input.description,
  };
}

/** Mismo formato que GET /plans (BillingController.listPlans). */
function toPlanItem(plan: Plan): PlatformPlanItem {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceMonthly: priceUsd(plan),
    storageLimitBytes: Number(plan.storageLimitBytes),
    userLimit: plan.maxMembers,
    validityDays: plan.validityDays ?? null,
  };
}

/**
 * Consultas de solo lectura para el dueño de la plataforma (SPEC-501). Sin auditoría: las lecturas no se registran.
 * La única escritura es la edición del catálogo (SPEC-504), que sí se audita.
 */
@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly billing: BillingService,
    private readonly files: FilesService,
    private readonly organizations: OrganizationRepository,
    @Optional() private readonly auditService?: AuditService,
  ) {}

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

  // ── SPEC-504: edición del catálogo de planes ──────────────────────────────

  /**
   * Edita un plan del catálogo en una sola transacción: bloquea el plan (Demo se rechaza), revisa las organizaciones
   * suscritas si el límite de almacenamiento baja y solo entonces escribe. La auditoría va después del commit y un
   * fallo en ella no cambia la respuesta.
   */
  async updatePlan(actor: AuthUser, planId: string, input: UpdatePlatformPlanInput): Promise<PlatformPlanItem> {
    const hasChanges = [input.priceMonthly, input.storageLimitGb, input.userLimit, input.description].some(
      (value) => value !== undefined,
    );
    if (!hasChanges) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Indica al menos un campo del plan a modificar',
      });
    }

    const changes = toPlanChanges(input);
    const plan = await this.dataSource.transaction(async (tx) => {
      const current = await this.billing.lockPlanForUpdate(tx, planId);
      if (
        changes.storageLimitBytes !== undefined &&
        BigInt(changes.storageLimitBytes) < BigInt(current.storageLimitBytes)
      ) {
        await this.assertSubscribersFitLimit(tx, planId, BigInt(changes.storageLimitBytes));
      }
      return this.billing.applyPlanChanges(tx, current, changes);
    });

    this.recordAudit({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: AuditAction.PLAN_UPDATED,
      resourceType: AuditResource.PLAN,
      resourceId: planId,
    });
    return toPlanItem(plan);
  }

  /**
   * Un límite más bajo solo es válido si ninguna organización suscrita ya usa más. Las organizaciones se bloquean en
   * orden de organization_id para evitar interbloqueos. Si el uso no se puede leer, se aborta: nunca se asume 0 bytes.
   * El mensaje no incluye ningún dato de la organización.
   */
  private async assertSubscribersFitLimit(tx: EntityManager, planId: string, newLimitBytes: bigint): Promise<void> {
    const subscribers = (await tx.query(PLAN_SUBSCRIBERS_SQL, [planId])) as Array<{ organizationId: string }>;

    for (const { organizationId } of subscribers) {
      if (!(await this.organizations.lockById(tx, organizationId, { allowReferences: true }))) continue;

      let totalBytes: bigint;
      try {
        ({ totalBytes } = await this.files.getTotalStorageUsage(organizationId, tx));
      } catch {
        throw new InternalServerErrorException({
          code: 'FILES_SERVICE_UNAVAILABLE',
          message: 'No fue posible validar el uso de almacenamiento. Operación abortada por seguridad.',
        });
      }

      if (totalBytes > newLimitBytes) {
        throw new UnprocessableEntityException({
          code: 'PLAN_LIMIT_BELOW_USAGE',
          message:
            'Hay organizaciones suscritas a este plan cuyo uso supera el nuevo límite de almacenamiento. Reduce el límite o pide que liberen espacio antes de intentarlo de nuevo.',
        });
      }
    }
  }

  /** Auditoría posterior al commit (D8, igual que PlatformActionsService): un fallo solo se registra en el log. */
  private recordAudit(input: AuditEventInput): void {
    const logFailure = (err: unknown): void => {
      this.logger.warn(
        `No se pudo registrar ${input.action} del plan ${input.resourceId}: ${
          err instanceof Error ? err.message : 'error desconocido'
        }`,
      );
    };
    try {
      void this.auditService?.logEvent(input).catch(logFailure);
    } catch (err) {
      logFailure(err);
    }
  }
}
