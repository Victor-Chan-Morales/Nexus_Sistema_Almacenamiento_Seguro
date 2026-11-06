# Lo que no tenía y queda pendiente

SPEC-407 (apps/web, solo mostrar "Sistema" o "Visitante" cuando actorId es nulo):
  lib/api/types.ts      → AuditEvent: actorId: string | null; actorType: 'user' | 'system' | 'visitor'
  components/audit-log.tsx → si actorId es null: mostrar "Sistema" (actorType = 'system') o "Visitante" (actorType = 'visitor')

SPEC-407 docs: ENTS_REGISTRY.md — audit.audit_outbox: actor_id ahora admite NULL; nuevas columnas actor_type y result.
SPEC-108 docs: los cambios de CONTRACTS.md e IAM.md van en docs/ (basados en tus versiones subidas).
