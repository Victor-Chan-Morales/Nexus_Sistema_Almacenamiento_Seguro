# Módulo Audit

**Dueño:** Anthony (Dominio Billing & Audit). **Spec:** SPEC-401.

## Responsabilidades

- Registrar eventos en `audit.audit_event` con `AuditService.logEvent()`.
- Encadenar cada evento por hash con el anterior de la **misma organización** (`prev_hash` → `record_hash`).
- Serializar los registros de una organización con un bloqueo consultivo, para que la cadena no se bifurque.

El módulo no edita IAM, Files ni Billing. Cada dueño engancha sus eventos en SPEC-405.

## Uso

```typescript
await this.auditService.logEvent({
  organizationId,
  actorId,
  action: AuditAction.FILE_UPLOAD,
  resourceType: AuditResource.FILE,
  resourceId: file.id,
});
```

- Llamar **después del commit** de la operación principal, nunca dentro de su transacción. Un error SQL dentro de ella la abortaría.
- `logEvent` **nunca lanza**. Si el INSERT falla, registra solo el código de error en el `Logger` y devuelve normalmente.
- La entrada no admite campos libres: no puede transportar contraseñas, tokens, llaves, nombres de archivo ni contenido.

## Eventos (`AuditAction`)

| Acción | Recurso típico |
|---|---|
| `AUTH_LOGIN` | `user` |
| `AUTH_PASSWORD_RESET` | `user` |
| `MEMBER_ADDED` | `membership` |
| `FILE_UPLOAD` | `file` |
| `FILE_DOWNLOAD` | `file` |
| `FILE_DELETE` | `file` |
| `FILE_RESTORE` | `file` |
| `FILE_PURGE` | `file` |
| `PLAN_ACTIVATED` | `subscription` |
| `PLAN_RENEWED` | `subscription` |

## Garantías

- **Inmutabilidad:** el servicio solo inserta. Los triggers de la BD rechazan `UPDATE`, `DELETE` y `TRUNCATE` (SQLSTATE 23001).
- **Hash:** `record_hash = sha256` sobre `prev_hash`, `event_id`, organización, actor, acción, recurso, resultado, correlación y `occurred_at`. Ver `computeRecordHash` en `apps/api/src/modules/audit/audit-hash.ts`.
- **Alcance del corte:** solo eventos `success` de actores `user`. Eventos fallidos, `visitor`/`system`, IP y agente de usuario quedan fuera (SPEC-401 §3).

## Fuera de este corte

- Verificación de la cadena y checkpoints firmados: SPEC-404.
- Consulta de eventos: SPEC-402.
