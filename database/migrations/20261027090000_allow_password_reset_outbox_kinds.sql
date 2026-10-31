-- migrate:up
-- SPEC-103 / ADR-007 §6: el outbox de correo deja de ser solo de verificación.
-- Se añaden los tipos de mensaje 'password_reset' (recuperación de contraseña) y 'member_invitation'
-- (alta de miembros, SPEC-102). La columna y el resto de restricciones no cambian.

ALTER TABLE iam.email_outbox DROP CONSTRAINT ck_email_outbox_kind;
ALTER TABLE iam.email_outbox ADD CONSTRAINT ck_email_outbox_kind
  CHECK (kind IN ('email_verification', 'password_reset', 'member_invitation'));

-- migrate:down
-- No borra datos. Si quedan mensajes de los tipos nuevos, la restauración de la restricción falla
-- y dbmate revierte la transacción: la tabla queda como estaba. Para descartarlos, decidirlo a mano.
ALTER TABLE iam.email_outbox DROP CONSTRAINT ck_email_outbox_kind;
ALTER TABLE iam.email_outbox ADD CONSTRAINT ck_email_outbox_kind
  CHECK (kind IN ('email_verification'));
