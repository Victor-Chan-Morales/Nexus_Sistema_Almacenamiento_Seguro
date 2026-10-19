# ADR-005: Esquema de Planes, Vigencia, Cuotas y Provisión Atómica de Billing

- **Estado:** Aprobada
- **Fecha:** 2026-10-18
- **Responsable:** Anthony (Billing) en coordinación con Sebastián (IAM), Miguel (Files) y Víctor (Web/Integración)

## Contexto

El Hito del 50% y la revisión del PR #4 exigen resolver inconsistencias en la gestión de planes y cuotas según la autoridad de `CONTRACTS.md` v0.3:
1. El plan Demo debe ser gratuito (US$ 0) y sin vencimiento (`expires_at: null`), mientras que los planes pagados tienen vigencia mensual (30 días).
2. Toda organización debe nacer con su suscripción Demo provisionada desde el registro; el alta de usuario, organización, membresía y suscripción inicial debe ser una operación atómica.
3. Se debe garantizar como máximo una sola suscripción activa por organización a nivel de base de datos y evitar condiciones de carrera en cambios de plan.
4. El cambio a un plan menor (downgrade) debe validarse contra el almacenamiento real ocupado por la organización (versiones retenidas + papelera en 30 días) más las reservas de carga activas antes de confirmar la suscripción.
5. Queda prohibido el uso de `ModuleRef` como anti-patrón de resolución dinámica; la coordinación entre dominios se realiza a través de un `SubscriptionCoordinator` en la capa de integración.
6. Los cambios en las entidades `Plan` (`description`, `validity_days`) y `Subscription` (`status`, `simulated`, `expires_at`) deben estar versionados en una migración ejecutable.

## Decisiones

1. **Catálogo y vigencia decimal:**
   - La entidad `Plan` almacena `validity_days` como entero anulable (`NULL` para planes sin vencimiento como Demo; `30` para planes mensuales).
   - Capacidades comerciales decimales aprobadas: Demo (`5000000000` bytes), Team (`100000000000` bytes), Business (`500000000000` bytes), Enterprise (`2000000000000` bytes).
   - La activación de Demo genera `expires_at = NULL`. Los planes pagados calculan `expires_at = now() + (validity_days * 86400s)`.
   - Si una suscripción con fecha de vencimiento es consultada y `expires_at < now()`, su estado transiciona a `expired` y su límite activo se considera 0 bytes (bloqueando nuevas subidas).

2. **Provisión atómica en registro:**
   - `IamService.register()` ejecuta una transacción única (`dataSource.transaction`) que involucra `User`, `Organization`, `Membership` y llama a `BillingService.provisionInitialSubscription(orgId, manager)`.
   - Se elimina la necesidad de que Files asuma valores por defecto ante organizaciones sin suscripción: toda organización válida tiene suscripción persistida.

3. **Concurrencia, transacciones e índice único:**
   - Se crea un índice único parcial en PostgreSQL:
     ```sql
     CREATE UNIQUE INDEX IF NOT EXISTS uq_active_org_subscription
     ON subscriptions (organization_id)
     WHERE status = 'active';
     ```
   - La activación repetida del mismo plan activo es idempotente (no cancela ni recrea el registro).
   - Un cambio de plan ejecuta una transacción atómica con bloqueo pesimista (`pessimistic_write`): cancela la suscripción anterior (`status = 'cancelled'`) y crea la nueva (`status = 'active'`).
   - Las colisiones de índice único (código 23505) son capturadas y devueltas como error 409 controlado (`CONCURRENT_SUBSCRIPTION_CONFLICT`).

4. **Coordinación de downgrades sin ModuleRef:**
   - `POST /subscriptions/activate` es orquestado por el `SubscriptionCoordinator` del módulo de integración.
   - Consulta a `FilesService.getTotalStorageUsage(orgId)` sumando versiones confirmadas, retención de 30 días en papelera y reservas activas.
   - Falla segura: si Files no responde o arroja error, aborta la transacción inmediatamente; nunca asume 0 bytes.
   - Si el espacio total excede la capacidad del nuevo plan, rechaza con `422 Unprocessable Entity` y `code: "STORAGE_QUOTA_EXCEEDED"`, según `CONTRACTS.md`: la cuota insuficiente es una regla de negocio (422), mientras `409` queda reservado para el conflicto de estado por activación concurrente.

## Script SQL de Migración (PostgreSQL)

Ubicación: `apps/api/src/migrations/1729267200000-AlterPlanAddDescriptionAndValidityDays.ts`, ejecutable con `npm run migration:run`.

`database/migrations/` en la raíz está reservada a las migraciones SQL canónicas de dbmate (esquema MER v3, `billing.plan`). Estas entidades usan otro esquema (`plans`), y una migración `.ts` colocada allí no es ejecutable: dbmate ignora los `.ts` y Node no puede resolver `typeorm` fuera de `apps/api`. Consolidar ambos esquemas en la ubicación canónica queda a cargo del integrador; ver `SESSION_LOG.md`.

```sql
-- 1. Agregar columnas a plans si no existen
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS validity_days INTEGER DEFAULT NULL;

-- 2. Asegurar columnas en subscriptions
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS simulated BOOLEAN NOT NULL DEFAULT true;

-- 3. Normalizar registros existentes deterministamente (última como active, anteriores cancelled)
WITH ranked_subs AS (
  SELECT id, organization_id, status,
         ROW_NUMBER() OVER (
           PARTITION BY organization_id
           ORDER BY created_at DESC, id DESC
         ) as rn
  FROM subscriptions
  WHERE status IN ('active', 'simulated')
)
UPDATE subscriptions s
SET status = CASE WHEN r.rn = 1 THEN 'active' ELSE 'cancelled' END,
    simulated = true
FROM ranked_subs r
WHERE s.id = r.id;

-- 4. Índice único parcial para garantizar máximo una suscripción activa por tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_org_subscription
ON subscriptions (organization_id)
WHERE status = 'active';

-- 5. Normalizar nombres del catálogo
UPDATE plans SET name = 'Demo' WHERE name = 'Plan Demo';
UPDATE plans SET name = 'Team' WHERE name = 'Plan Team';
UPDATE plans SET name = 'Business' WHERE name = 'Plan Business';
UPDATE plans SET name = 'Enterprise' WHERE name = 'Plan Enterprise';

-- 6. Sembrar/Actualizar catálogo base oficial con capacidades decimales
INSERT INTO plans (id, name, description, price_cents, storage_limit_bytes, max_members, validity_days, storage_location, active, created_at)
VALUES
  (gen_random_uuid(), 'Demo', 'Prueba el espacio de trabajo de Nexus con capacidad para una organización pequeña.', 0, 5000000000, 5, NULL, 'cloud', true, NOW()),
  (gen_random_uuid(), 'Team', 'Almacenamiento seguro para equipos pequeños que comparten archivos de trabajo.', 1999, 100000000000, 10, 30, 'cloud', true, NOW()),
  (gen_random_uuid(), 'Business', 'Más capacidad y espacio para organizaciones en crecimiento.', 5999, 500000000000, 30, 30, 'cloud', true, NOW()),
  (gen_random_uuid(), 'Enterprise', 'Capacidad ampliada para organizaciones con mayor volumen.', 14999, 2000000000000, 100, 30, 'cloud', true, NOW())
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents,
  storage_limit_bytes = EXCLUDED.storage_limit_bytes,
  max_members = EXCLUDED.max_members,
  validity_days = EXCLUDED.validity_days,
  active = true;
```

## Consecuencias

- El modelo queda completamente alineado con la regla de negocio aprobada y la autoridad absoluta de `CONTRACTS.md` v0.3.
- Se elimina el anti-patrón de `ModuleRef`, reemplazándolo por una orquestación limpia y tipada a través de `SubscriptionCoordinator`.
- Toda organización nueva tiene cuota y suscripción persistidas garantizadas.
- La base de datos y la capa de integración protegen contra carreras y estados duplicados.
