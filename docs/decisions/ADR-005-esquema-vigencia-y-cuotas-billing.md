# ADR-005: Esquema de Planes, Vigencia, Cuotas y Provisión Atómica de Billing

- **Estado:** Aprobada
- **Fecha:** 2026-10-18
- **Responsable:** Anthony (Billing) en coordinación con Sebastián (IAM), Miguel (Files) y Víctor (Web/Integración)

## Contexto

El Hito del 50% y la revisión del PR #4 exigen resolver inconsistencias en la gestión de planes y cuotas:
1. El Plan Demo debe ser gratuito (US$ 0) y sin vencimiento (`expires_at: null`), mientras que los planes pagados tienen vigencia mensual (30 días).
2. Toda organización debe nacer con su suscripción Demo provisionada desde el registro; el alta de usuario, organización, membresía y suscripción inicial debe ser una operación atómica.
3. Se debe garantizar como máximo una sola suscripción activa por organización a nivel de base de datos y evitar condiciones de carrera en cambios de plan.
4. El cambio a un plan menor (downgrade) debe validarse contra el almacenamiento real ocupado por la organización antes de confirmar la suscripción.
5. Los cambios en las entidades `Plan` (`description`, `validity_days`) y `Subscription` (`status`, `simulated`, `expires_at`) deben estar versionados con script de migración.

## Decisiones

1. **Catálogo y vigencia:**
   - La entidad `Plan` almacena `validity_days` como entero anulable (`NULL` para planes sin vencimiento como Demo; `30` para planes mensuales).
   - La activación de Demo genera `expires_at = NULL`. Los planes pagados calculan `expires_at = now() + (validity_days * 86400s)`.
   - Si una suscripción con fecha de vencimiento es consultada y `expires_at < now()`, su estado transiciona a `expired` y su límite activo se considera 0 bytes (bloqueando nuevas subidas).

2. **Provisión atómica en registro:**
   - `IamService.register()` ejecuta una transacción única (`dataSource.transaction`) que involucra `User`, `Organization`, `Membership` y llama a `BillingService.provisionInitialSubscription(orgId, manager)`.
   - Se elimina la necesidad de que Files asuma valores por defecto ante organizaciones sin suscripción: toda organización válida tiene suscripción persistida.

3. **Concurrencia e idempotencia en suscripciones:**
   - Se crea un índice único parcial en PostgreSQL:
     ```sql
     CREATE UNIQUE INDEX IF NOT EXISTS uq_active_org_subscription
     ON subscriptions (organization_id)
     WHERE status = 'active';
     ```
   - La activación repetida del mismo plan activo es idempotente (no cancela ni recrea el registro).
   - Un cambio de plan ejecuta una transacción atómica: cancela la suscripción anterior (`status = 'cancelled'`) y crea la nueva (`status = 'active'`).

4. **Validación de downgrade in-process:**
   - Antes de aplicar un cambio de plan, `BillingService` consulta el uso confirmado de almacenamiento invocando `FilesService.getUsedStorageBytes(orgId)` a través de `ModuleRef`, evitando acoplamiento cíclico estático.
   - Si el uso supera la cuota del nuevo plan, la solicitud es rechazada con código `409 Conflict` (`ERROR_DOWNGRADE_STORAGE_EXCEEDED`).

## Script SQL de Migración (PostgreSQL)

```sql
-- 1. Agregar columnas a plans si no existen
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS validity_days INTEGER DEFAULT NULL;

-- 2. Asegurar columnas en subscriptions
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS simulated BOOLEAN DEFAULT true,
  ALTER COLUMN status SET DEFAULT 'active';

-- 3. Actualizar suscripciones históricas marcadas como 'simulated' en status
UPDATE subscriptions
SET status = 'active', simulated = true
WHERE status = 'simulated';

-- 4. Índice único parcial para garantizar máximo una suscripción activa por tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_org_subscription
ON subscriptions (organization_id)
WHERE status = 'active';

-- 5. Sembrar/Actualizar catálogo base
INSERT INTO plans (id, name, description, price_cents, storage_limit_bytes, max_members, validity_days, storage_location, active, created_at)
VALUES
  (gen_random_uuid(), 'Plan Demo', 'Prueba el espacio de trabajo de Nexus con capacidad para una organización pequeña.', 0, 5368709120, 5, NULL, 'cloud', true, NOW()),
  (gen_random_uuid(), 'Plan Team', 'Almacenamiento seguro para equipos pequeños que comparten archivos de trabajo.', 1999, 107374182400, 10, 30, 'cloud', true, NOW()),
  (gen_random_uuid(), 'Plan Business', 'Más capacidad y espacio para organizaciones en crecimiento.', 5999, 536870912000, 30, 30, 'cloud', true, NOW()),
  (gen_random_uuid(), 'Plan Enterprise', 'Capacidad ampliada para organizaciones con mayor volumen.', 14999, 2147483648000, 100, 30, 'cloud', true, NOW())
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents,
  storage_limit_bytes = EXCLUDED.storage_limit_bytes,
  max_members = EXCLUDED.max_members,
  validity_days = EXCLUDED.validity_days,
  active = true;
```

## Consecuencias

- El modelo queda completamente alineado con la regla de negocio aprobada (Demo gratuito y permanente; Team/Business/Enterprise mensuales).
- Toda organización nueva tiene cuota y suscripción persistidas garantizadas.
- La base de datos protege contra estados duplicados y transiciones concurrentes inconsistentes.
