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
- **Operaciones con varios eventos:** si una misma petición registra más de un evento, pasar el mismo `correlationId` en todas las llamadas. Si se omite, cada evento recibe un UUID propio y no se pueden unir después.

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
- **Orden de la cadena:** `chain_seq` (1, 2, 3… por organización). El último evento es el de mayor `chain_seq`. La BD rechaza dos eventos con el mismo `chain_seq` o con el mismo `prev_hash` dentro de una organización.
- **Hash:** `record_hash = sha256` sobre `JSON.stringify` de `prev_hash`, `chain_seq`, `event_id`, organización, actor, acción, recurso, `safe_reason`, resultado, correlación y `occurred_at`. Ver `computeRecordHash` en `apps/api/src/modules/audit/audit-hash.ts`.
- **Corte de formato:** el hash cambió dos veces en la rama (separador `|` → JSON, y luego `chain_seq` y `safe_reason`). Las filas escritas con un formato anterior no se pueden verificar con la función actual. La migración no recalcula hashes. Si una base de desarrollo tiene filas de `ecc99e9` o de un commit anterior a `c6c12fa`, reiniciarla (`docker compose down -v` y migrar de nuevo, según `database/README.md`) en vez de migrarla.
- **Alcance del corte:** solo eventos `success` de actores `user`. Eventos fallidos, `visitor`/`system`, IP y agente de usuario quedan fuera (SPEC-401 §3).

## Invariantes

- **I1 Sin pérdida por reintento.** Un fallo transitorio se reintenta sin límite de tiempo. `dead` es solo para errores permanentes (FK, NOT NULL, tipo, CHECK) y toda fila `dead` es recuperable (ver abajo).
- **I2 Orden = `chain_seq`.** `occurred_at` es el momento de captura y puede ser anterior al de inserción en la cadena (un evento reenviado desde el outbox). Quien verifique la cadena (SPEC-402, SPEC-404) debe recorrerla por `chain_seq` y `prev_hash`, nunca por `occurred_at`.
- **I3 Una fila, un procesador.** Cada fila del outbox se reclama de una en una con un lease corto; dos instancias no la procesan a la vez.
- **I4 Registro y baja atómicos.** El evento entra en la cadena y sale del outbox en la misma transacción.
- **I5 Riesgo residual.** Si ni el INSERT directo ni el encolado funcionan (BD caída por completo), el evento se pierde y queda `[AUDIT_EVENT_LOST]` en el log.

## Reintento (outbox)

Si el INSERT directo falla, `logEvent` guarda el evento en `audit.audit_outbox` con el mismo `event_id` y `correlation_id`. Un worker lo reintenta cada 30 s con espera creciente (2 min, tope 30 min) hasta que entra en la cadena. Si el mismo evento ya estaba en la cadena (el INSERT llegó pero el cliente vio un error), no se duplica. A diferencia del outbox de correo, **no hay horizonte de abandono**.

- **Eventos `dead`:** solo un error permanente. Se conservan en la tabla y se registran con `[AUDIT_OUTBOX_DEAD]`. Revisarlos: `SELECT * FROM audit.audit_outbox WHERE status = 'dead';`
- **Re-drive:** tras corregir la causa (p. ej. crear el actor que faltaba):
  `UPDATE audit.audit_outbox SET status = 'pending', attempts = 0, next_attempt_at = now(), locked_until = NULL WHERE status = 'dead' AND event_id = '<id>';`
- **Eventos atascados:** pasadas 24 h desde la captura, cada intento fallido registra `[AUDIT_OUTBOX_STALE]` pero la fila sigue `pending`. Es la señal para alertar.
- **Salud:** `GET /api/health` no expone datos de auditoría (es público y no requiere autenticación). Se vigilan los marcadores `[AUDIT_OUTBOX_DEAD]`, `[AUDIT_OUTBOX_STALE]` y `[AUDIT_EVENT_LOST]` en el log.

## Riesgos conocidos

- **Pérdida residual:** si el proceso o la BD caen entre el commit de la operación de negocio y el encolado en el outbox, el evento se pierde. Solo lo cubre encolar dentro de la transacción de negocio (`enqueue(tx)`), que queda para SPEC-405.
- **Correlación opcional:** si una operación registra varios eventos sin el mismo `correlationId`, no quedan unidos (ver arriba).

## Fuera de este corte

- Verificación de la cadena y checkpoints firmados: SPEC-404.
- Consulta de eventos: SPEC-402.
