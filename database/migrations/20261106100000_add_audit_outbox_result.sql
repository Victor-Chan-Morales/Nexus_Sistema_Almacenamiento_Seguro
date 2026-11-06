-- migrate:up
-- SPEC-802: el outbox conserva el resultado y la causa segura con que se intentó registrar el evento.
-- Sin estas columnas, un evento de prueba de conexión fallida se reenviaría como `success`.
-- Las filas existentes son eventos de éxito.
ALTER TABLE audit.audit_outbox
  ADD COLUMN result audit.event_result NOT NULL DEFAULT 'success',
  ADD COLUMN safe_reason varchar(255);
COMMENT ON COLUMN audit.audit_outbox.result IS 'success / failure: resultado con el que se intentó registrar el evento.';
COMMENT ON COLUMN audit.audit_outbox.safe_reason IS 'Motivo seguro de un fallo. Nunca un mensaje crudo ni datos sensibles.';

-- migrate:down
ALTER TABLE audit.audit_outbox
  DROP COLUMN safe_reason,
  DROP COLUMN result;
