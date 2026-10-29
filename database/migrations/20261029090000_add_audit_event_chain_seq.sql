-- migrate:up
-- Orden determinista de la cadena de auditoría (SPEC-401, hallazgo de la revisión del PR #16).
-- Elegir el último evento por occurred_at y event_id no basta: dos eventos en el mismo milisegundo pueden empatar
-- y dos eventos heredarían el mismo prev_hash, con lo que la cadena se bifurca. chain_seq es una secuencia por
-- organización que AuditService asigna bajo el bloqueo consultivo, y las constraints de abajo hacen imposible una
-- bifurcación aunque el código fallara.

ALTER TABLE audit.audit_event ADD COLUMN chain_seq bigint;

-- Antes de tocar nada se comprueba que la cadena existente es lineal. Una bifurcación (dos raíces o dos hijos del
-- mismo padre) o un evento que no cuelga de ninguna raíz haría fallar más abajo la UNIQUE o el NOT NULL con un
-- mensaje que no dice qué organización arreglar. Aquí la migración se detiene antes de deshabilitar el trigger y
-- nombra las organizaciones afectadas. Remedio: reparar esas cadenas a mano (o reiniciar una base de desarrollo,
-- ver database/README.md) y volver a migrar.
--
-- lock_timeout evita esperar sin límite el ACCESS EXCLUSIVE de DISABLE TRIGGER si hay escrituras en curso.
-- DISABLE TRIGGER exige ser propietario de la tabla: dbmate usa el rol de migraciones, que lo es.
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
  affected text;
BEGIN
  SELECT string_agg(DISTINCT organization_id::text, ', ') INTO affected FROM (
    SELECT organization_id FROM audit.audit_event
     WHERE prev_hash IS NULL GROUP BY organization_id HAVING count(*) > 1
    UNION ALL
    SELECT organization_id FROM audit.audit_event
     WHERE prev_hash IS NOT NULL GROUP BY organization_id, prev_hash HAVING count(*) > 1
  ) AS forked;
  IF affected IS NOT NULL THEN
    RAISE EXCEPTION 'Cadena de auditoría bifurcada (varias raíces o hijos del mismo padre) en organizaciones: %', affected;
  END IF;

  WITH RECURSIVE chain AS (
    SELECT event_id, organization_id, record_hash
      FROM audit.audit_event
     WHERE prev_hash IS NULL
    UNION ALL
    SELECT e.event_id, e.organization_id, e.record_hash
      FROM audit.audit_event AS e
      JOIN chain AS c
        ON c.organization_id = e.organization_id
       AND c.record_hash = e.prev_hash
  )
  SELECT string_agg(DISTINCT e.organization_id::text, ', ') INTO affected
    FROM audit.audit_event AS e
    LEFT JOIN chain AS c ON c.event_id = e.event_id
   WHERE c.event_id IS NULL;
  IF affected IS NOT NULL THEN
    RAISE EXCEPTION 'Eventos de auditoría que no cuelgan de ninguna raíz en organizaciones: %', affected;
  END IF;
END $$;

-- El backfill recorre la cadena desde la raíz (prev_hash NULL) siguiendo prev_hash -> record_hash, en vez de ordenar
-- por occurred_at: dos eventos del mismo milisegundo pueden tener el orden de cadena opuesto al de su reloj.
-- No hay riesgo de ciclo: cerrarlo exigiría una colisión de SHA-256.
--
-- El trigger de inmutabilidad rechaza UPDATE. Se deshabilita solo para este backfill; dbmate ejecuta la migración
-- dentro de una transacción.
ALTER TABLE audit.audit_event DISABLE TRIGGER trg_audit_event_reject_update_delete;
WITH RECURSIVE chain AS (
  SELECT event_id, organization_id, record_hash, 1::bigint AS seq
    FROM audit.audit_event
   WHERE prev_hash IS NULL
  UNION ALL
  SELECT e.event_id, e.organization_id, e.record_hash, c.seq + 1
    FROM audit.audit_event AS e
    JOIN chain AS c
      ON c.organization_id = e.organization_id
     AND c.record_hash = e.prev_hash
)
UPDATE audit.audit_event AS e
   SET chain_seq = chain.seq
  FROM chain
 WHERE e.event_id = chain.event_id;
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
