# SPEC-407: ACTORES Y RESULTADOS DE AUDITORÍA

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (auditoría y migración) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/audit/`, `database/migrations/` |
| **Requisitos Vinculados** | RF-012, RNF-007 |
| **Dependencias** | SPEC-004 |
| **Prioridad** | P1 |
| **Estimación** | 1 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

`AuditChainWriter` fija `actorType = user` y `result = success`, y el outbox exige `actor_id`. La purga automática (`system`), el acceso público por enlace (`visitor`) y los fallos (`failure`) no se pueden registrar. Esta spec lo habilita.

## 3. Fuera de Alcance

- Enganchar eventos concretos: cada spec agrega los suyos.
- Cambiar el cálculo del hash.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Compatibilidad
  Dada una llamada actual a logEvent con actorId
  Entonces registra actor_type = user y result = success, igual que hoy

Escenario 2: Actor sistema o visitante
  Cuando logEvent recibe actorType = system o visitor, sin actorId
  Entonces guarda actor_id NULL y cumple ck_audit_event_actor

Escenario 3: Combinación inválida
  Cuando recibe actorType = user sin actorId, o visitor con actorId
  Entonces no escribe el evento, registra el error y no lanza excepción

Escenario 4: Resultado failure
  Cuando recibe result = failure
  Entonces lo guarda y el hash lo incluye

Escenario 5: Outbox
  Dado un fallo del INSERT directo con actor visitor y result failure
  Cuando el worker reintenta
  Entonces el evento se escribe con los mismos actor y resultado

Escenario 6: Cadena intacta
  Dados eventos antiguos y nuevos
  Entonces computeRecordHash de los antiguos sigue dando el mismo valor
```

## 5. Contrato de API

Sin rutas. Interfaz interna:

```typescript
export interface AuditEventInput {
  organizationId: string;
  actorId?: string;
  actorType?: AuditActorType;   // por defecto USER
  result?: AuditResult;         // por defecto SUCCESS
  action: AuditAction;
  resourceType?: AuditResource;
  resourceId?: string;
  correlationId?: string;
}
```

`GET /audit/events`: `actorId` pasa a admitir `null` y se añade `actorType`.

## 6. Datos y Esquema

Migración `<fecha>_extend_audit_outbox_actor.sql` sobre `audit.audit_outbox`:

```sql
-- migrate:up
ALTER TABLE audit.audit_outbox ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE audit.audit_outbox ADD COLUMN actor_type audit.actor_type NOT NULL DEFAULT 'user';
ALTER TABLE audit.audit_outbox ADD COLUMN result audit.event_result NOT NULL DEFAULT 'success';
-- migrate:down: eliminar columnas y restaurar NOT NULL (borra antes filas sin actor)
```

`audit.audit_event` ya admite estos valores.

## 8. Diseño Técnico

- `ResolvedAuditEvent` y `AuditChainWriter.append` usan `event.actorType ?? USER` y `event.result ?? SUCCESS`.
- `logEvent` sigue sin lanzar nunca.
- **Riesgo:** el hash incluye `actorType` y `result`, y los valores por defecto deben dar el mismo resultado para los eventos existentes (escenario 6).

## 9. Plan de Tareas

- [ ] **T1 (15 min)**: Migración y entidad del outbox.
- [ ] **T2 (25 min)**: Tipos, writer, servicio y outbox.
- [ ] **T3 (20 min)**: Pruebas.

**Archivos permitidos:** `audit.types.ts`, `audit-chain-writer.ts`, `audit.service.ts`, `audit-outbox.service.ts`, `entities/audit-outbox.entity.ts`, `dto/list-audit-events.dto.ts`, sus `*.spec.ts`, la migración, `apps/web/src/components/audit-log.tsx` y `apps/web/src/lib/api/types.ts` (solo mostrar "Sistema" o "Visitante" si `actorId` es nulo).

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–4, 6 | Unitaria | `audit.service.spec.ts` |
| Escenario 5 | Unitaria | `audit-outbox.service.spec.ts` |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6: forma de `GET /audit/events`.
- [ ] `ENTS_REGISTRY.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial; surge de revisar el código para SPEC-215 y SPEC-216. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
