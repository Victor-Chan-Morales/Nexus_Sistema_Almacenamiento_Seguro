-- migrate:up
-- Tablas del dominio billing (PK inline: una tabla sin PK nunca es un estado intermedio válido). FK, UNIQUE, CHECK e índices van en migraciones posteriores.

CREATE TABLE billing.plan (
  plan_id           uuid           NOT NULL DEFAULT gen_random_uuid(),
  name              varchar(100)   NOT NULL,
  storage_limit_gb  integer        NOT NULL,
  user_limit        integer        NOT NULL,
  price_monthly     numeric(10,2)  NOT NULL,
  created_at        timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT pk_plan PRIMARY KEY (plan_id)
);
COMMENT ON TABLE billing.plan IS 'Plan comercial simulado con sus límites de almacenamiento y usuarios.';
COMMENT ON COLUMN billing.plan.plan_id IS 'Identificador del plan';
COMMENT ON COLUMN billing.plan.name IS 'Nombre comercial';
COMMENT ON COLUMN billing.plan.storage_limit_gb IS 'Límite de almacenamiento';
COMMENT ON COLUMN billing.plan.user_limit IS 'Límite de usuarios';
COMMENT ON COLUMN billing.plan.price_monthly IS 'Precio simulado mensual';
COMMENT ON COLUMN billing.plan.created_at IS 'Fecha de creación';

CREATE TABLE billing.subscription (
  subscription_id  uuid                         NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid                         NOT NULL,
  plan_id          uuid                         NOT NULL,
  status           billing.subscription_status  NOT NULL DEFAULT 'active',
  start_date       date                         NOT NULL,
  end_date         date,
  created_at       timestamptz                  NOT NULL DEFAULT now(),
  CONSTRAINT pk_subscription PRIMARY KEY (subscription_id)
);
COMMENT ON TABLE billing.subscription IS 'Suscripción de una organización a un plan (facturación simulada).';
COMMENT ON COLUMN billing.subscription.subscription_id IS 'Identificador de la suscripción';
COMMENT ON COLUMN billing.subscription.organization_id IS 'Organización suscrita';
COMMENT ON COLUMN billing.subscription.plan_id IS 'Plan contratado';
COMMENT ON COLUMN billing.subscription.status IS 'active / expired / cancelled';
COMMENT ON COLUMN billing.subscription.start_date IS 'Inicio de vigencia';
COMMENT ON COLUMN billing.subscription.end_date IS 'Fin de vigencia';
COMMENT ON COLUMN billing.subscription.created_at IS 'Fecha de contratación';

CREATE TABLE billing.plan_revision (
  revision_id           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  subscription_id       uuid                     NOT NULL,
  new_storage_limit_gb  integer                  NOT NULL,
  status                billing.revision_status  NOT NULL DEFAULT 'pending',
  requested_at          timestamptz              NOT NULL DEFAULT now(),
  confirmed_at          timestamptz,
  CONSTRAINT pk_plan_revision PRIMARY KEY (revision_id)
);
COMMENT ON TABLE billing.plan_revision IS 'Cambio de límite de un plan que queda pendiente hasta que Files lo confirma bajo el bloqueo de cuota.';
COMMENT ON COLUMN billing.plan_revision.revision_id IS 'Identificador de la revisión';
COMMENT ON COLUMN billing.plan_revision.subscription_id IS 'Suscripción afectada';
COMMENT ON COLUMN billing.plan_revision.new_storage_limit_gb IS 'Nuevo límite propuesto';
COMMENT ON COLUMN billing.plan_revision.status IS 'pending / confirmed / rejected';
COMMENT ON COLUMN billing.plan_revision.requested_at IS 'Fecha de solicitud';
COMMENT ON COLUMN billing.plan_revision.confirmed_at IS 'Fecha de confirmación';

CREATE TABLE billing.billing_operation (
  operation_id     uuid                    NOT NULL DEFAULT gen_random_uuid(),
  subscription_id  uuid                    NOT NULL,
  type             billing.operation_type  NOT NULL,
  amount           numeric(10,2),
  simulated_at     timestamptz             NOT NULL DEFAULT now(),
  CONSTRAINT pk_billing_operation PRIMARY KEY (operation_id)
);
COMMENT ON TABLE billing.billing_operation IS 'Historial de operaciones de facturación simulada (cargos y renovaciones). Nunca mueve dinero real.';
COMMENT ON COLUMN billing.billing_operation.operation_id IS 'Identificador de la operación';
COMMENT ON COLUMN billing.billing_operation.subscription_id IS 'Suscripción relacionada';
COMMENT ON COLUMN billing.billing_operation.type IS 'charge / renewal — simulado';
COMMENT ON COLUMN billing.billing_operation.amount IS 'Monto simulado';
COMMENT ON COLUMN billing.billing_operation.simulated_at IS 'Fecha de la operación';

-- migrate:down
DROP TABLE billing.billing_operation;
DROP TABLE billing.plan_revision;
DROP TABLE billing.subscription;
DROP TABLE billing.plan;
