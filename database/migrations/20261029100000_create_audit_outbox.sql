-- migrate:up
-- Outbox de auditoría (SPEC-401, issue #17). Si el INSERT en audit.audit_event falla después de que la operación
-- de negocio ya se confirmó, el evento se guarda aquí y un worker lo reintenta hasta registrarlo en la cadena.
-- Es una cola mutable: las filas registradas se borran; las 'dead' se conservan para revisión.

CREATE TABLE audit.audit_outbox (
  event_id         uuid            NOT NULL,
  organization_id  uuid            NOT NULL,
  actor_id         uuid            NOT NULL,
  action_type      varchar(50)     NOT NULL,
  resource_type    varchar(20),
  resource_id      uuid,
  correlation_id   uuid            NOT NULL,
  occurred_at      timestamptz     NOT NULL,
  status           varchar(20)     NOT NULL DEFAULT 'pending',
  attempts         integer         NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz     NOT NULL DEFAULT now(),
  last_error       varchar(100),
  created_at       timestamptz     NOT NULL DEFAULT now(),
  CONSTRAINT pk_audit_outbox PRIMARY KEY (event_id),
  CONSTRAINT ck_audit_outbox_status CHECK (status IN ('pending', 'dead')),
  CONSTRAINT ck_audit_outbox_attempts CHECK (attempts >= 0)
);
CREATE INDEX ix_audit_outbox_due ON audit.audit_outbox (status, next_attempt_at);

COMMENT ON TABLE audit.audit_outbox IS 'Eventos de auditoría pendientes de registrar en la cadena; el worker reintenta los fallos transitorios.';
COMMENT ON COLUMN audit.audit_outbox.event_id IS 'Identificador del evento; la PK impide encolar dos veces el mismo evento.';
COMMENT ON COLUMN audit.audit_outbox.status IS 'pending: se reintenta. dead: agotó el horizonte o falló de forma permanente; se conserva para revisión.';
COMMENT ON COLUMN audit.audit_outbox.last_error IS 'Código del último error (nunca el mensaje del motor ni datos del evento).';

-- migrate:down
DROP TABLE audit.audit_outbox;
