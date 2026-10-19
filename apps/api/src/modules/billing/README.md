# Módulo Billing

Billing mantiene el catálogo de planes y las suscripciones de cada organización. Sus entidades TypeORM usan directamente el esquema canónico `billing` definido en `database/migrations/`.

## Integración con IAM

`BillingModule` importa `IamModule` y registra el hook requerido `demo-subscription`. Durante el alta, IAM ejecuta ese hook con el `EntityManager` de su transacción. `BillingService.provisionInitialSubscription()` crea la suscripción Demo con ese mismo manager, de modo que el usuario, la organización, la membresía, el Drive personal y la suscripción inicial se confirman o revierten juntos.

La suscripción referencia el UUID de la organización que entrega IAM. No busca ni reutiliza organizaciones por nombre.

## Esquema y migraciones

| Entidad | Tabla canónica | Mapeo principal |
|---|---|---|
| `Plan` | `billing.plan` | `priceCents` ↔ `price_monthly`; `storageLimitBytes` ↔ `storage_limit_gb`; `maxMembers` ↔ `user_limit` |
| `Subscription` | `billing.subscription` | `id` ↔ `subscription_id`; `organizationId` ↔ `organization_id`; `expiresAt` ↔ `end_date` |

`start_date` y `end_date` son fechas sin hora. `simulated`, `active` y `storageLocation` son propiedades de compatibilidad en memoria; no se persisten como columnas.

El catálogo de referencia es insertado por `database/migrations/20261019090100_insert_reference_data_plans.sql`. `database/migrations/20261019090200_add_billing_plan_metadata.sql` agrega descripción y vigencia (`NULL` para Demo, 30 días para los planes de pago). El inicio de la API valida que estén los cuatro planes; no los crea ni sobrescribe.

Ejecuta las migraciones desde la raíz del repositorio con `npm run migration:run`. Para revertir la última migración: `npm run migration:revert`.

La base impone una suscripción `active` como máximo por organización mediante `billing.uq_subscription_one_active_per_organization`. Billing y el coordinador de integración traducen una colisión concurrente a `409 CONCURRENT_SUBSCRIPTION_CONFLICT`.

## Endpoints

| Método y ruta | Acceso | Función |
|---|---|---|
| `GET /api/plans` | Público / autenticado | Devuelve los planes del catálogo, con límites expresados en bytes y precios en USD. |
| `POST /api/subscriptions/activate` | JWT | Activa un plan para la organización del token; el coordinador valida cuotas con Files antes de persistir. |

`BillingService.getStorageLimitBytes(organizationId)` sirve a Files en proceso. Si no hay una suscripción vigente, devuelve cero bytes.
