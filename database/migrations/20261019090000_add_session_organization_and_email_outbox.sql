-- migrate:up
-- Sesión con la organización activa del login: el refresh conserva esa organización y revalida su membresía
-- (CONTRACTS.md, IAM y sesión).
ALTER TABLE iam.session ADD COLUMN organization_id uuid;

-- Las sesiones anteriores a esta migración no tienen organización conocida: se revocan y el usuario inicia sesión de nuevo.
DELETE FROM iam.session;

ALTER TABLE iam.session ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE iam.session
  ADD CONSTRAINT fk_session_organization FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id) ON DELETE CASCADE;
CREATE INDEX ix_session_organization ON iam.session (organization_id);

COMMENT ON COLUMN iam.session.organization_id IS 'Organización activa con la que se abrió la sesión; el refresh la conserva.';

-- Outbox persistente de correo (CONTRACTS.md, registro): el mensaje se guarda dentro de la transacción del registro
-- y se envía después del commit, con reintentos. El token viaja cifrado y el payload se borra al enviar o vencer.
CREATE TABLE iam.email_outbox (
  outbox_id          uuid          NOT NULL DEFAULT gen_random_uuid(),
  kind               varchar(40)   NOT NULL,
  user_id            uuid          NOT NULL,
  recipient_email    varchar(255)  NOT NULL,
  recipient_name     varchar(255)  NOT NULL,
  encrypted_payload  text          NOT NULL,
  status             varchar(20)   NOT NULL DEFAULT 'pending',
  attempts           integer       NOT NULL DEFAULT 0,
  next_attempt_at    timestamptz   NOT NULL DEFAULT now(),
  expires_at         timestamptz   NOT NULL,
  last_error         varchar(100),
  created_at         timestamptz   NOT NULL DEFAULT now(),
  sent_at            timestamptz,
  CONSTRAINT pk_email_outbox PRIMARY KEY (outbox_id),
  CONSTRAINT fk_email_outbox_user FOREIGN KEY (user_id)
    REFERENCES iam."user" (user_id) ON DELETE CASCADE,
  CONSTRAINT ck_email_outbox_kind CHECK (kind IN ('email_verification')),
  CONSTRAINT ck_email_outbox_status CHECK (status IN ('pending', 'sent', 'expired'))
);
CREATE INDEX ix_email_outbox_due ON iam.email_outbox (status, next_attempt_at);

COMMENT ON TABLE iam.email_outbox IS 'Mensajes de correo pendientes de enviar; reintenta fallos temporales del proveedor.';
COMMENT ON COLUMN iam.email_outbox.user_id IS 'Usuario destinatario; permite emitir un token nuevo si el anterior vence esperando al proveedor.';
COMMENT ON COLUMN iam.email_outbox.encrypted_payload IS 'Token en claro cifrado (AES-256-GCM). Se vacía al enviar o vencer.';
COMMENT ON COLUMN iam.email_outbox.expires_at IS 'Vencimiento del token vigente; se actualiza si el reintento emite otro.';

-- migrate:down
DROP TABLE IF EXISTS iam.email_outbox;
DROP INDEX IF EXISTS iam.ix_session_organization;
ALTER TABLE iam.session DROP CONSTRAINT IF EXISTS fk_session_organization;
ALTER TABLE iam.session DROP COLUMN IF EXISTS organization_id;
