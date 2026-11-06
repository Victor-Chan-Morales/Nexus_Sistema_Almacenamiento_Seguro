-- migrate:up
-- SPEC-407: el outbox de auditoría deja de suponer un actor persona y un resultado exitoso. Así puede reintentar
-- eventos de la purga automática ('system'), del acceso público por enlace ('visitor') y fallos ('failure').
-- Las filas existentes quedan como 'user' / 'success', igual que antes. audit.audit_event ya admite estos valores.
ALTER TABLE audit.audit_outbox ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE audit.audit_outbox ADD COLUMN actor_type audit.actor_type NOT NULL DEFAULT 'user';
ALTER TABLE audit.audit_outbox ADD COLUMN result audit.event_result NOT NULL DEFAULT 'success';
-- Misma regla que ck_audit_event_actor: una combinación inválida no puede entrar al outbox, porque nunca se registraría.
ALTER TABLE audit.audit_outbox
  ADD CONSTRAINT ck_audit_outbox_actor CHECK ((actor_type = 'user') = (actor_id IS NOT NULL));
COMMENT ON COLUMN audit.audit_outbox.actor_type IS 'user, visitor o system. Se copia tal cual a audit.audit_event.';
COMMENT ON COLUMN audit.audit_outbox.result IS 'success o failure. Se copia tal cual a audit.audit_event.';

-- migrate:down
-- No borra datos. Si quedan eventos sin actor, de visitante o sistema, o con resultado failure, la restauración
-- falla y dbmate revierte la transacción: el outbox queda como estaba. Descartarlos es una decisión manual.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM audit.audit_outbox
     WHERE actor_id IS NULL OR actor_type <> 'user' OR result <> 'success'
  ) THEN
    RAISE EXCEPTION 'audit_outbox tiene eventos de sistema, visitante o fallo: no se puede restaurar el esquema anterior sin perderlos';
  END IF;
END $$;
ALTER TABLE audit.audit_outbox DROP CONSTRAINT ck_audit_outbox_actor;
ALTER TABLE audit.audit_outbox DROP COLUMN result;
ALTER TABLE audit.audit_outbox DROP COLUMN actor_type;
ALTER TABLE audit.audit_outbox ALTER COLUMN actor_id SET NOT NULL;
