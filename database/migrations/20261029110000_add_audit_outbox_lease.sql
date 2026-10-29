-- migrate:up
-- Arrendamiento explícito del worker de auditoría (revisión del PR #16). Antes el lease reutilizaba next_attempt_at,
-- así que "en proceso" y "reintento programado" compartían columna y un lote lento podía volver a tomarse.
ALTER TABLE audit.audit_outbox ADD COLUMN locked_until timestamptz;
COMMENT ON COLUMN audit.audit_outbox.locked_until IS 'Arrendamiento del worker que está procesando la fila. Vencido, otra instancia puede tomarla.';

-- migrate:down
ALTER TABLE audit.audit_outbox DROP COLUMN locked_until;
