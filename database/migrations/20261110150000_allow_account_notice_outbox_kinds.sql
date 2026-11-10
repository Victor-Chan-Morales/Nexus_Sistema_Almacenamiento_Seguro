-- migrate:up
-- SPEC-115: avisos informativos sin enlaces ni tokens.
ALTER TABLE iam.email_outbox DROP CONSTRAINT ck_email_outbox_kind;
ALTER TABLE iam.email_outbox ADD CONSTRAINT ck_email_outbox_kind
  CHECK (kind IN ('email_verification', 'password_reset', 'member_invitation',
                  'plan_changed', 'member_status_changed', 'organization_closed'));

-- migrate:down
-- Si quedan avisos informativos, se revierte la migración de bajada sin borrar datos.
ALTER TABLE iam.email_outbox DROP CONSTRAINT ck_email_outbox_kind;
ALTER TABLE iam.email_outbox ADD CONSTRAINT ck_email_outbox_kind
  CHECK (kind IN ('email_verification', 'password_reset', 'member_invitation'));
