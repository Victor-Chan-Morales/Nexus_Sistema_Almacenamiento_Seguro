-- migrate:up
-- Tablas del dominio audit (PK inline: una tabla sin PK nunca es un estado intermedio válido). FK, UNIQUE, CHECK e índices van en migraciones posteriores.

CREATE TABLE audit.audit_event (
  event_id         uuid                NOT NULL,
  organization_id  uuid                NOT NULL,
  actor_type       audit.actor_type    NOT NULL,
  actor_id         uuid,
  action_type      varchar(50)         NOT NULL,
  resource_type    varchar(20),
  resource_id      uuid,
  result           audit.event_result  NOT NULL,
  correlation_id   uuid                NOT NULL,
  safe_reason      varchar(255),
  prev_hash        varchar(128),
  record_hash      varchar(128)        NOT NULL,
  occurred_at      timestamptz         NOT NULL,
  CONSTRAINT pk_audit_event PRIMARY KEY (event_id)
);
COMMENT ON TABLE audit.audit_event IS 'Evento de auditoría append-only con cadena de hashes por organización (RNF-007, DA-06). UPDATE, DELETE y TRUNCATE están bloqueados por trigger.';
COMMENT ON COLUMN audit.audit_event.event_id IS 'Deduplicación al consumir de Redis Streams';
COMMENT ON COLUMN audit.audit_event.organization_id IS 'Organización donde ocurrió';
COMMENT ON COLUMN audit.audit_event.actor_type IS 'user / visitor / system';
COMMENT ON COLUMN audit.audit_event.actor_id IS 'Usuario, si actor_type = user';
COMMENT ON COLUMN audit.audit_event.action_type IS 'login / upload / download / share / delete / permission_change, etc.';
COMMENT ON COLUMN audit.audit_event.resource_type IS 'Tipo de recurso afectado';
COMMENT ON COLUMN audit.audit_event.resource_id IS 'Recurso afectado';
COMMENT ON COLUMN audit.audit_event.result IS 'success / failure';
COMMENT ON COLUMN audit.audit_event.correlation_id IS 'Une eventos de una misma operación';
COMMENT ON COLUMN audit.audit_event.safe_reason IS 'Motivo seguro — nunca contraseñas, tokens, JWT, DEK, KEK';
COMMENT ON COLUMN audit.audit_event.prev_hash IS 'Hash del evento anterior de la misma organización';
COMMENT ON COLUMN audit.audit_event.record_hash IS 'Hash de este evento';
COMMENT ON COLUMN audit.audit_event.occurred_at IS 'Momento del evento (UTC)';

CREATE TABLE audit.audit_chain_checkpoint (
  checkpoint_id    uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid          NOT NULL,
  last_event_id    uuid          NOT NULL,
  chain_hash       varchar(128)  NOT NULL,
  signature        varchar(500)  NOT NULL,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_audit_chain_checkpoint PRIMARY KEY (checkpoint_id)
);
COMMENT ON TABLE audit.audit_chain_checkpoint IS 'Resumen firmado periódico de la cadena de hashes de una organización. Append-only.';
COMMENT ON COLUMN audit.audit_chain_checkpoint.checkpoint_id IS 'Identificador del checkpoint';
COMMENT ON COLUMN audit.audit_chain_checkpoint.organization_id IS 'Organización';
COMMENT ON COLUMN audit.audit_chain_checkpoint.last_event_id IS 'Último evento incluido en la cadena';
COMMENT ON COLUMN audit.audit_chain_checkpoint.chain_hash IS 'Hash acumulado hasta ese punto';
COMMENT ON COLUMN audit.audit_chain_checkpoint.signature IS 'Firma del resumen';
COMMENT ON COLUMN audit.audit_chain_checkpoint.created_at IS 'Fecha del checkpoint';

-- migrate:down
DROP TABLE audit.audit_chain_checkpoint;
DROP TABLE audit.audit_event;
