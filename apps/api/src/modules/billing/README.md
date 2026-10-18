# Módulo Billing

**Responsable:** Anthony (según `ENTS_REGISTRY.md` y `Planes de trabajo individuales/PLAN_ANTHONY_BILLING.md`).

## Responsabilidades
- **Catálogo de planes persistido:** Define los 4 planes aprobados (Demo, Team, Business, Enterprise). El Plan Demo es gratuito ($0 USD), con 5 GB de cuota, 5 usuarios y **sin vencimiento** (`validityDays: null`, `expiresAt: null`). Los planes de pago tienen vigencia mensual (30 días).
- **Provisión atómica inicial:** Expone `provisionInitialSubscription(organizationId, entityManager)` para que `IamService` asigne el Plan Demo durante el registro atómico de usuario y organización en PostgreSQL.
- **Activación y cambio de suscripción transaccional:** Permite activar o cambiar de plan vía `POST /api/subscriptions/activate` con validación estricta de DTO (`class-validator`). Marca las suscripciones con `simulated: true` y no acepta datos de tarjeta.
- **Validación de downgrade:** Antes de aplicar un cambio de plan, consulta el uso en bytes mediante `FilesService.getUsedStorageBytes(organizationId)` y rechaza el cambio si el uso supera la cuota del nuevo plan (`409 Conflict`).
- **Idempotencia:** La activación repetida del plan activo actual no cancela ni recrea filas en la base de datos; retorna la suscripción vigente.
- **Gestión centralizada de cuotas in-process:** Exporta `BillingService.getStorageLimitBytes(organizationId)` consumido directamente en memoria por `FilesModule` antes de cada carga de archivo (sin llamadas HTTP). Si la suscripción ha vencido, retorna 0 bytes para rechazar la subida.

## Endpoints HTTP

| Método y ruta | Protección | Entrada | Salida | Descripción |
|---|---|---|---|---|
| `GET /api/plans` | Público / Auth | Ninguna | `{ items: PlanItem[] }` | Lista el catálogo aprobado con precio mensual en USD y límite en bytes. |
| `POST /api/subscriptions/activate` | JWT (`req.user.organizationId`) | `{ planId: UUID }` | `SubscriptionActivationResponse` | Activa/cambia plan para la organización autenticada (`simulated: true`). |
| `GET /api/billing/subscription` | JWT (`req.user.organizationId`) | Ninguna | `SubscriptionDetailResponse` | Consulta el detalle y vigencia del plan de la organización. |

## Comunicación en el Monolito Modular

1. **`IamModule` → `BillingService`:** Invoca `provisionInitialSubscription` pasando el `EntityManager` transaccional del registro.
2. **`FilesModule` → `BillingService`:** Invoca `getStorageLimitBytes(organizationId)` in-process antes de subir archivos.
3. **`BillingService` → `FilesService`:** Consulta `getUsedStorageBytes(organizationId)` vía `ModuleRef` para validar downgrades sin dependencias circulares.

## Integridad de Base de Datos

- **Restricción de Concurrencia:** Índice único parcial `uq_active_org_subscription` en PostgreSQL (`WHERE status = 'active'`), garantizando que ninguna organización pueda tener más de una suscripción activa simultáneamente.
- **Seeding Repetible:** `seedDefaultPlans()` se ejecuta en el arranque del servicio. No oculta errores y asegura la presencia y actualización de los 4 planes aprobados.
