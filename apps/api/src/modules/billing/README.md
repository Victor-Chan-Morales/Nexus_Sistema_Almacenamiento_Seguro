# Módulo Billing

**Responsable:** Anthony (según `ENTS_REGISTRY.md` y `Planes de trabajo individuales/PLAN_ANTHONY_BILLING.md`).

## Responsabilidades
- **Catálogo de planes persistido:** Define los 4 planes aprobados (Demo, Team, Business, Enterprise) con capacidades decimales exactas según `CONTRACTS.md` v0.3. El plan Demo es gratuito ($0 USD), con 5 GB (`5000000000` bytes), 5 usuarios y **sin vencimiento** (`validityDays: null`, `expiresAt: null`). Los planes de pago tienen vigencia mensual (30 días).
- **Provisión atómica inicial:** Expone `provisionInitialSubscription(organizationId, entityManager)` para que `IamService` asigne el plan Demo durante el registro atómico de usuario y organización en PostgreSQL.
- **Persistencia transaccional de suscripciones:** Expone `persistSubscription(organizationId, targetPlan, manager)` utilizado por el coordinador de integración para persistir activaciones y cambios de plan con bloqueo pesimista.
- **Idempotencia:** La activación repetida del plan activo actual no cancela ni recrea filas en la base de datos; retorna la suscripción vigente.
- **Gestión centralizada de cuotas in-process:** Exporta `BillingService.getStorageLimitBytes(organizationId)` consumido directamente en memoria por `FilesModule` antes de cada carga de archivo (sin llamadas HTTP). Si la suscripción ha vencido o no existe, retorna 0 bytes para rechazar la subida.
- **Zero ModuleRef:** No utiliza inyecciones dinámicas ni resuelve dependencias de otros módulos mediante `ModuleRef`. La validación de downgrade y el cruce entre dominios se delegan al `SubscriptionCoordinator` del módulo de integración.

## Endpoints HTTP

| Método y ruta | Protección | Entrada | Salida | Descripción |
|---|---|---|---|---|
| `GET /api/plans` | Público / Auth | Ninguna | `{ items: PlanItem[] }` | Lista el catálogo aprobado con precio mensual en USD y límites decimales en bytes. |
| `POST /api/subscriptions/activate` | JWT (`req.user.organizationId`) | `{ planId: UUID }` | `SubscriptionActivationResponse` | Coordinado por `SubscriptionCoordinator` (Integración): valida downgrade y persiste plan. |

> **Nota:** La ruta `GET /api/billing/subscription` fue retirada de la API pública al no ser consumida por el frontend; internamente, `BillingService.getSubscription(organizationId)` provee exclusivamente la suscripción vigente (o `null`).
> Toda respuesta de error en los controladores de la API emite estrictamente `{ code, message, requestId }` mediante `ApiExceptionFilter`.

## Catálogo Aprobado (CONTRACTS.md v0.3)

| Plan | Precio mensual | Almacenamiento | Usuarios | Vigencia |
|---|---:|---:|---:|---|
| Demo | US$ 0 | 5 GB (`5000000000` bytes) | 5 | Sin vencimiento (`validityDays: null`) |
| Team | US$ 19.99 | 100 GB (`100000000000` bytes) | 10 | 30 días |
| Business | US$ 59.99 | 500 GB (`500000000000` bytes) | 30 | 30 días |
| Enterprise | US$ 149.99 | 2 TB (`2000000000000` bytes) | 100 | 30 días |

## Comunicación en el Monolito Modular

1. **`IamModule` → `BillingService`:** Invoca `provisionInitialSubscription` pasando el `EntityManager` transaccional del registro.
2. **`FilesModule` → `BillingService`:** Invoca `getStorageLimitBytes(organizationId)` in-process antes de subir archivos.
3. **`IntegrationModule` (`SubscriptionCoordinator`) → `FilesModule` y `BillingService`:** Coordina la validación de almacenamiento (versiones + papelera en 30 días + reservas activas) antes de delegar la persistencia transaccional a `BillingService`.

## Integridad de Base de Datos y Migraciones

- **Restricción de Concurrencia:** Índice único parcial `uq_active_org_subscription` en PostgreSQL (`WHERE status = 'active'`), garantizando que ninguna organización pueda tener más de una suscripción activa simultáneamente. Colisiones concurrentes son capturadas (código 23505) y transformadas en HTTP 409 controlado.
- **Migración:** `apps/api/src/migrations/1729267200000-AlterPlanAddDescriptionAndValidityDays.ts`, ejecutable vía `npm run migration:run`. No siembra el catálogo: su única fuente es `seedDefaultPlans()`. Consolidarla con las migraciones SQL canónicas de `database/migrations/` queda a cargo del integrador (ver `SESSION_LOG.md`).
- **Cuota insuficiente en un cambio de plan:** `422` con `code: "STORAGE_QUOTA_EXCEEDED"`, según `CONTRACTS.md`. El `409` queda solo para el conflicto por activación concurrente.
- **Seeding Fail-Fast:** `seedDefaultPlans()` se ejecuta en el arranque del servicio. No oculta errores y asegura la presencia y actualización de los 4 planes aprobados.
