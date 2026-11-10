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

`billing.billing_operation` guarda `card_last4` (`char(4)`, `NULL` en cargos de US$0 y renovaciones de planes gratuitos): solo los últimos cuatro dígitos de la tarjeta de prueba aprobada. Nunca se persisten el número completo ni el CVV (SPEC-305).

La base impone una suscripción `active` como máximo por organización mediante `billing.uq_subscription_one_active_per_organization`. Billing y el coordinador de integración traducen una colisión concurrente a `409 CONCURRENT_SUBSCRIPTION_CONFLICT`.

## Endpoints

| Método y ruta | Acceso | Función |
|---|---|---|
| `GET /api/plans` | Público / autenticado | Devuelve los planes del catálogo, con límites expresados en bytes y precios en USD. |
| `POST /api/subscriptions/activate` | JWT, `tenant_admin` | Activa un plan para la organización del token; el coordinador valida cuotas con Files antes de persistir. |
| `POST /api/subscriptions/renew` | JWT, `tenant_admin` | Extiende la vigencia de la suscripción actual. |
| `GET /api/billing/operations` | JWT, `tenant_admin` | Historial de operaciones simuladas; cada elemento incluye `cardLast4` (`string \| null`, SPEC-305). |
| `GET /api/billing/operations/:id/receipt` | JWT, `tenant_admin` | Comprobante de una operación de la organización (SPEC-306). Solo expone los últimos cuatro dígitos de la tarjeta. Operación inexistente, ajena o con `:id` que no es UUID → `404 NOT_FOUND`. |

`BillingService.getStorageLimitBytes(organizationId)` sirve a Files en proceso. Si no hay una suscripción vigente, devuelve cero bytes.
