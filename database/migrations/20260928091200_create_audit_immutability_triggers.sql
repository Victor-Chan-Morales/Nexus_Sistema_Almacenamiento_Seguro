-- migrate:up
-- Auditoría append-only (RNF-007, DA-06): UPDATE, DELETE y TRUNCATE sobre las tablas de auditoría fallan con
-- restrict_violation (SQLSTATE 23001), sin importar qué cuenta se use. Un superusuario aún podría deshabilitar el trigger:
-- en producción, además, conectar los servicios con un rol sin privilegios de DDL (ver database/README.md).

CREATE FUNCTION audit.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit.%: la operación % no está permitida (registros append-only)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
COMMENT ON FUNCTION audit.reject_mutation() IS 'Trigger que rechaza UPDATE/DELETE/TRUNCATE en tablas de auditoría.';

CREATE TRIGGER trg_audit_event_reject_update_delete
  BEFORE UPDATE OR DELETE ON audit.audit_event
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER trg_audit_event_reject_truncate
  BEFORE TRUNCATE ON audit.audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();

CREATE TRIGGER trg_audit_chain_checkpoint_reject_update_delete
  BEFORE UPDATE OR DELETE ON audit.audit_chain_checkpoint
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER trg_audit_chain_checkpoint_reject_truncate
  BEFORE TRUNCATE ON audit.audit_chain_checkpoint
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();

-- migrate:down
DROP TRIGGER trg_audit_chain_checkpoint_reject_update_delete ON audit.audit_chain_checkpoint;
DROP TRIGGER trg_audit_chain_checkpoint_reject_truncate ON audit.audit_chain_checkpoint;
DROP TRIGGER trg_audit_event_reject_update_delete ON audit.audit_event;
DROP TRIGGER trg_audit_event_reject_truncate ON audit.audit_event;
DROP FUNCTION audit.reject_mutation();
