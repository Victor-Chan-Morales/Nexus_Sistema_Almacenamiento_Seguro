-- migrate:up
-- SPEC-407: el outbox de auditoría deja de suponer un actor persona. Así puede reintentar eventos de la purga
-- automática ('system') y del acceso público por enlace ('visitor'). Las filas existentes quedan como 'user'.
-- Las columnas result y safe_reason las añade 20261106100000 (SPEC-802): esta migración va después y no las repite.
ALTER TABLE audit.audit_outbox ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE audit.audit_outbox ADD COLUMN actor_type audit.actor_type NOT NULL DEFAULT 'user';
-- Misma regla que ck_audit_event_actor: una combinación inválida no puede entrar al outbox, porque nunca se registraría.
ALTER TABLE audit.audit_outbox
  ADD CONSTRAINT ck_audit_outbox_actor CHECK ((actor_type = 'user') = (actor_id IS NOT NULL));
COMMENT ON COLUMN audit.audit_outbox.actor_type IS 'user, visitor o system. Se copia tal cual a audit.audit_event.';

-- migrate:down
-- No borra datos. Si quedan eventos sin actor, de visitante o de sistema, la restauración falla y dbmate revierte la
-- transacción: el outbox queda como estaba. Descartarlos es una decisión manual. Las columnas result y safe_reason
-- no se tocan aquí: su restauración pertenece a 20261106100000.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM audit.audit_outbox
     WHERE actor_id IS NULL OR actor_type <> 'user'
  ) THEN
    RAISE EXCEPTION 'audit_outbox tiene eventos de sistema o visitante: no se puede restaurar el esquema anterior sin perderlos';
  END IF;
END $$;
ALTER TABLE audit.audit_outbox DROP CONSTRAINT ck_audit_outbox_actor;
ALTER TABLE audit.audit_outbox DROP COLUMN actor_type;
ALTER TABLE audit.audit_outbox ALTER COLUMN actor_id SET NOT NULL;
