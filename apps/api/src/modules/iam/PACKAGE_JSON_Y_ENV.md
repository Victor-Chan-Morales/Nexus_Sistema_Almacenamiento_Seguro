# Cambios fuera de los archivos entregados (no los tenía)

apps/api/package.json → "scripts":
  "seed:super-admin": "ts-node src/scripts/seed-super-admin.ts"      (mismo patrón que seed:demo)

package.json (raíz) → "scripts":
  "seed:super-admin": "npm run seed:super-admin --workspace=apps/api"   (mismo patrón que seed:demo)

.env.example:
  # Solo para `npm run seed:super-admin` (cuenta del dueño de la plataforma). No se usan en la API.
  SUPER_ADMIN_EMAIL=
  SUPER_ADMIN_PASSWORD=

apps/web/src/lib/api/types.ts:
  LoginResponse y MeResponse: añadir  isSuperAdmin: boolean;
  nuevos tipos: PlatformOrganization { id, name, status, deploymentModel, planName: string | null, usedBytes,
    storageLimitBytes: number | null, memberCount, createdAt }, PlatformOrganizationsResponse { items, total },
    PlatformMetrics { organizations: { active, suspended, cancelled }, activeUsers, usedBytes,
    subscriptionsByPlan: { planName, count }[] }
