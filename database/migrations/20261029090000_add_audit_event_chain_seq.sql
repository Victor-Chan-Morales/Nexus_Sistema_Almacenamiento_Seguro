-- migrate:up
-- Orden determinista de la cadena de auditoría (SPEC-401, hallazgo de la revisión del PR #16).
-- Elegir el último evento por occurred_at y event_id no basta: dos eventos en el mismo milisegundo pueden empatar
-- y dos eventos heredarían el mismo prev_hash, con lo que la cadena se bifurca. chain_seq es una secuencia por
-- organización que AuditService asigna bajo el bloqueo consultivo, y las constraints de abajo hacen imposible una
-- bifurcación aunque el código fallara.

ALTER TABLE audit.audit_event ADD COLUMN chain_seq bigint;

-- El trigger de inmutabilidad rechaza UPDATE. Se deshabilita solo para este backfill; dbmate ejecuta la migración
-- dentro de una transacción. Si la tabla ya tuviera una bifurcación, la UNIQUE sobre prev_hash de abajo falla y
-- la migración no se aplica.
ALTER TABLE audit.audit_event DISABLE TRIGGER trg_audit_event_reject_update_delete;
UPDATE audit.audit_event AS e
   SET chain_seq = s.seq
  FROM (
    SELECT event_id,
           row_number() OVER (PARTITION BY organization_id ORDER BY occurred_at, event_id) AS seq
      FROM audit.audit_event
  ) AS s
 WHERE e.event_id = s.event_id;
ALTER TABLE audit.audit_event ENABLE TRIGGER trg_audit_event_reject_update_delete;

ALTER TABLE audit.audit_event ALTER COLUMN chain_seq SET NOT NULL;

ALTER TABLE audit.audit_event
  ADD CONSTRAINT uq_audit_event_organization_chain_seq UNIQUE (organization_id, chain_seq);
COMMENT ON COLUMN audit.audit_event.chain_seq IS 'Posición del evento en la cadena de su organización (1, 2, 3…). Determina el último evento.';

-- Un solo hijo por padre: dos eventos no pueden compartir prev_hash dentro de la organización.
CREATE UNIQUE INDEX uq_audit_event_organization_prev_hash
  ON audit.audit_event (organization_id, prev_hash) WHERE prev_hash IS NOT NULL;
-- Una sola raíz por organización (UNIQUE no cubre NULL repetidos).
CREATE UNIQUE INDEX uq_audit_event_organization_root
  ON audit.audit_event (organization_id) WHERE prev_hash IS NULL;

-- migrate:down
DROP INDEX audit.uq_audit_event_organization_root;
DROP INDEX audit.uq_audit_event_organization_prev_hash;
ALTER TABLE audit.audit_event DROP CONSTRAINT uq_audit_event_organization_chain_seq;
ALTER TABLE audit.audit_event DROP COLUMN chain_seq;
