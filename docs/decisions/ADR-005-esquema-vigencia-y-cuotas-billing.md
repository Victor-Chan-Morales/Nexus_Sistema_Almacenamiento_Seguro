# ADR-005: Esquema, vigencia, cuotas e integración de Billing

- **Estado:** Aprobada
- **Fecha:** 2026-10-19
- **Responsables:** Billing, IAM, Files e Integración

## Contexto

La revisión de la PR #4 encontró que sus entidades y su migración TypeORM usaban `plans` y `subscriptions` en el esquema `public`. El repositorio ya define las tablas de Billing en `billing.plan` y `billing.subscription`, y el IAM integrado participa en el registro mediante hooks obligatorios. Mantener los modelos de la PR habría separado Billing del esquema y del flujo de alta reales.

## Decisiones

1. **Esquema canónico:** las entidades TypeORM se mapean a `billing.plan` y `billing.subscription`. UUID, nombres de columnas, enum, fechas y el índice único parcial coinciden con las migraciones dbmate en `database/migrations/`.
2. **Mapeo de unidades:** el servicio conserva precio en centavos y almacenamiento en bytes. Los transformers convierten a `price_monthly` (USD `numeric(10,2)`) y `storage_limit_gb` (GB decimales enteros).
3. **Catálogo versionado:** los cuatro planes se insertan en `20261019090100_insert_reference_data_plans.sql`; la migración `20261019090200_add_billing_plan_metadata.sql` agrega descripción y vigencia. El arranque valida ese catálogo y falla si faltan filas; no las crea ni modifica.
4. **Registro IAM atómico:** `DemoSubscriptionHook` registra el hook obligatorio `demo-subscription`. IAM lo ejecuta dentro de la transacción de registro y Billing usa el `EntityManager` recibido para guardar la suscripción Demo junto con la organización y la membresía.
5. **Fechas y vigencia:** `start_date` y `end_date` se persisten como fechas PostgreSQL sin hora. Demo no vence; los planes de pago vencen al alcanzar `end_date` en UTC.
6. **Concurrencia:** `billing.uq_subscription_one_active_per_organization` permite como máximo una suscripción activa por organización. Las colisiones concurrentes se traducen en `409 CONCURRENT_SUBSCRIPTION_CONFLICT`.
7. **Cuotas:** `SubscriptionCoordinator` consulta Files antes de aceptar un cambio que reduciría la cuota. Si Files falla, la operación se aborta; si el uso y las reservas exceden el límite del plan, responde `422 STORAGE_QUOTA_EXCEEDED`.
8. **Migraciones:** dbmate es la única vía de migración del esquema compartido. Las migraciones TypeORM antiguas de Billing que alteraban tablas `public.plans` y `public.subscriptions` se retiraron.

## Consecuencias

- IAM y Billing comparten la organización y la transacción durante el alta, sin una dependencia de IAM hacia un servicio de infraestructura antigua.
- Las entidades de Billing ya no requieren columnas que no existen en el esquema canónico (`active`, `storage_location`, `simulated` o `updated_at`). Las propiedades de compatibilidad permanecen en memoria donde las usa la API.
- El esquema, el catálogo y los metadatos se despliegan con `npm run migration:run` desde la raíz del repositorio.

La documentación operativa está en [`apps/api/src/modules/billing/README.md`](../../apps/api/src/modules/billing/README.md).
