-- migrate:up
-- SPEC-103 / ADR-007 §6: el outbox de correo deja de ser solo de verificación.
-- Se añaden los tipos de mensaje 'password_reset' (recuperación de contraseña) y 'member_invitation'
-- (alta de miembros, SPEC-102). La columna y el resto de restricciones no cambian.

ALTER TABLE iam.email_outbox DROP CONSTRAINT ck_email_outbox_kind;
ALTER TABLE iam.email_outbox ADD CONSTRAINT ck_email_outbox_kind
  CHECK (kind IN ('email_verification', 'password_reset', 'member_invitation'));

-- migrate:down
-- Los mensajes de los tipos nuevos no caben en la restricción anterior: se descartan antes de restaurarla.
DELETE FROM iam.email_outbox WHERE kind <> 'email_verification';
ALTER TABLE iam.email_outbox DROP CONSTRAINT ck_email_outbox_kind;
ALTER TABLE iam.email_outbox ADD CONSTRAINT ck_email_outbox_kind
  CHECK (kind IN ('email_verification'));
