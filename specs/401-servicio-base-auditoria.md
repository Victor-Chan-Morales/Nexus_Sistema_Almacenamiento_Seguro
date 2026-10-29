# SPEC-401: SERVICIO BASE DE AUDITORÍA

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (módulo nuevo de auditoría, integridad de registros) |
| **Responsable Principal** | Anthony (Dominio Billing & Audit) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/audit/` (módulo nuevo) y `apps/api/src/app.module.ts` (registrarlo) |
| **Requisitos Vinculados** | RF-012, RNF-007 |
| **Dependencias** | Ninguna. **Bloquea a** 402 y 405. **Va primero** junto con 101. |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) |
| **Estimación** | 2.5 h |
| **Estado** | Aprobada (2026-10-28, Víctor Chán) |

---

## 2. Objetivo

Crear `AuditModule` con `AuditService.logEvent()` sobre la tabla existente `audit.audit_event`. El módulo **no edita IAM, Files ni Billing**: cada dueño engancha sus eventos en SPEC-405. Hoy hay cero código de auditoría aunque las tablas, los triggers de inmutabilidad y los índices ya existen.

---

## 3. Fuera de Alcance (YAGNI)

- Verificar la cadena de hashes, checkpoints firmados y verificación de integridad: SPEC-404 (100%).
- Registrar eventos fallidos (el esquema exige `organization_id`; un login fallido no lo tiene) y eventos `visitor`/`system`.
- Redis Streams u otra cola: el registro es síncrono tras el commit (Constitución art. 3).
- Metadatos libres, IP y agente de usuario: la tabla no tiene esas columnas; no se añaden en este corte.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Registro de un evento
  Dado que un servicio llama logEvent({ organizationId, actorId, action: "FILE_UPLOAD", resourceType: "file", resourceId })
  Entonces se inserta una fila en audit.audit_event con event_id (UUID generado por la app), actor_type "user", actor_id, action_type, resource_type, resource_id, result "success", correlation_id y occurred_at
  Y record_hash no vacío y prev_hash = NULL si es el primer evento de la organización

Escenario 2: Encadenamiento
  Dado un segundo evento de la misma organización
  Entonces su prev_hash es igual al record_hash del evento anterior de esa organización
  Y otra organización tiene su propia cadena independiente

Escenario 3: Eventos concurrentes
  Dado dos eventos simultáneos de la misma organización
  Entonces se serializan (bloqueo por organización) y la cadena no se bifurca

Escenario 4: Nunca bloquea la operación
  Dado que el INSERT falla
  Entonces logEvent no lanza excepción: registra el error con el Logger (sin datos del evento) y devuelve normalmente
  Y el evento se guarda en audit.audit_outbox con el mismo event_id y correlation_id, y se reintenta hasta registrarse en la cadena
  Y si el error es permanente o pasan 24 h, el evento queda 'dead' y se registra [AUDIT_OUTBOX_DEAD]; GET /api/health informa cuántos hay

Escenario 5: Sin datos sensibles
  Entonces el evento no contiene contraseñas, tokens, llaves, nombres de archivo ni contenido

Escenario 6: Inmutabilidad
  Entonces el servicio solo inserta; UPDATE/DELETE los rechaza el trigger de la BD
```

---

## 5. Contrato de API

No expone endpoints (la lectura es SPEC-402). Contrato interno:

```typescript
export interface AuditEventInput {
  organizationId: string;
  actorId: string;
  action: AuditAction;            // enum cerrado, ver abajo
  resourceType?: AuditResource;   // 'user' | 'membership' | 'file' | 'subscription'
  resourceId?: string;
  correlationId?: string;         // si falta, se genera un UUID por llamada
}
logEvent(input: AuditEventInput): Promise<void>; // nunca lanza
```

`AuditAction` (≤ 50 caracteres): `AUTH_LOGIN`, `AUTH_PASSWORD_RESET`, `MEMBER_ADDED`, `FILE_UPLOAD`, `FILE_DOWNLOAD`, `FILE_DELETE`, `FILE_RESTORE`, `FILE_PURGE`, `PLAN_ACTIVATED`, `PLAN_RENEWED`. `AuditResource` ≤ 20 caracteres (`resource_type` es `varchar(20)`).

---

## 6. Datos y Esquema

- **¿Modifica BD?** Sí, una migración: `20261029090000_add_audit_event_chain_seq.sql` añade `chain_seq` (bigint NOT NULL, único por organización) y dos índices únicos sobre `prev_hash` y la raíz de cada organización. Esquema de `audit.audit_event` tras la migración:

| Columna | Tipo | Nota |
|---|---|---|
| `event_id` | uuid PK | **sin default**: lo genera la app (`randomUUID()`) |
| `organization_id` | uuid NOT NULL | del contexto autenticado |
| `actor_type` | enum `user`/`visitor`/`system` | en este corte siempre `user` |
| `actor_id` | uuid | CHECK: no nulo si y solo si `actor_type = 'user'` |
| `action_type` | varchar(50) NOT NULL | no vacío |
| `resource_type` | varchar(20) | |
| `resource_id` | uuid | |
| `result` | enum `success`/`failure` NOT NULL | siempre `success` |
| `correlation_id` | uuid NOT NULL | |
| `safe_reason` | varchar(255) | no se usa en este corte |
| `chain_seq` | bigint NOT NULL | posición en la cadena de la organización (1, 2, 3…); `UNIQUE (organization_id, chain_seq)` |
| `prev_hash`, `record_hash` | varchar(128) | `record_hash` NOT NULL y no vacío; un único hijo por `prev_hash` dentro de la organización |
| `occurred_at` | timestamptz NOT NULL | |

- La entidad TypeORM va con `@Entity({ schema: 'audit', name: 'audit_event' })` (la versión anterior de la spec omitía el esquema, lo que apuntaría a `public`) y los enum como `enum` con `enumName`, igual que `subscription.entity.ts`. **No** tiene `metadata`, `ip_address`, `user_id` ni `created_at`.

---

## 7. Interfaz de Usuario

No aplica.

---

## 8. Diseño Técnico

- `AuditModule` marcado `@Global()` y exportando `AuditService`: IAM, Files y Billing lo inyectan sin importarlo y **sin dependencia circular** (AuditModule no importa ningún módulo de dominio).
- **`logEvent`:** abre su propia transacción: `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))` con el `organizationId` → leer el último `record_hash` de la organización (`ORDER BY chain_seq DESC LIMIT 1`, con `select` solo de `recordHash` y `chainSeq`) → fijar `occurred_at = new Date()` **dentro del bloqueo** → asignar `chain_seq = último + 1` → calcular el hash → insertar. Todo envuelto en `try/catch`.
- **Orden de la cadena:** no se ordena por `occurred_at` ni por `event_id`. Dos eventos en el mismo milisegundo empataban y podían heredar el mismo `prev_hash` (bifurcación). `chain_seq` se asigna bajo el bloqueo y la BD rechaza dos hijos del mismo padre (`uq_audit_event_organization_prev_hash`) y dos eventos con el mismo `chain_seq` (`uq_audit_event_organization_chain_seq`).
- **Hash:** `record_hash = sha256_hex( JSON.stringify([prev_hash ?? '', chain_seq, event_id, organization_id, actor_type, actor_id ?? '', action_type, resource_type ?? '', resource_id ?? '', safe_reason ?? '', result, correlation_id, occurred_at.toISOString()]) )`. Las filas escritas con un formato anterior de hash no son verificables; las bases de desarrollo con esas filas se reinician en vez de migrarse (ver `docs/modules/AUDIT.md`). Se serializa con JSON y no con un separador: un valor que contenga `|` no puede colisionar con otro. Función pura y testeable (`computeRecordHash`).
- **Cuándo se llama:** después del commit de la operación principal, nunca dentro de su transacción (un error SQL dentro de ella la abortaría).
- **Outbox de reintento (issue #17):** si el registro directo falla, `logEvent` encola el evento en `audit.audit_outbox` con el `event_id`, el `correlation_id` y el momento de captura que intentó. `AuditOutboxService` lo reintenta cada 30 s con espera creciente (2 min, tope 30 min) durante 24 h. Antes de insertar en la cadena comprueba que el `event_id` no esté ya, así un intento confirmado a medias no se duplica. Los errores permanentes (FK, NOT NULL, tipo, CHECK) pasan a `dead` de inmediato. `AuditChainWriter` concentra la escritura en la cadena y lo usan el registro directo y el worker.
- **Momento del evento recuperado:** `occurred_at` es el de captura, anterior al de bloqueo. Por eso el orden temporal de un evento recuperado puede no coincidir con su posición en `chain_seq`; la cadena se ordena por `chain_seq`.
- **Riesgos:** (a) bifurcación de la cadena con inserciones concurrentes → bloqueo consultivo y constraints únicas; (b) un fallo de auditoría rompiendo la operación del usuario → `logEvent` no lanza y el evento va al outbox; (c) filtrar datos sensibles → el tipo de entrada no admite campos libres; (d) residual: si el proceso o la BD caen entre el commit de la operación y el encolado, el evento se pierde. Solo cubriría esto encolar dentro de la transacción de negocio (`enqueue(tx)`), que queda para SPEC-405.

---

## 9. Plan de Tareas

- [x] **T1 (30 min)**: entidad (esquema `audit`), enums de acción/recurso y `AuditModule` global registrado en `AppModule`.
- [x] **T2 (50 min)**: `AuditService.logEvent` con bloqueo, cadena y `try/catch`; `computeRecordHash`.
- [x] **T3 (50 min)**: pruebas (escenarios 1–6; hash determinista; cadena por organización; el error no se propaga). Escenarios 3 y 6 verificados contra Postgres 16; en el 6, TRUNCATE lo bloquea primero la FK de `audit_chain_checkpoint` (0A000) y el trigger (23001) se comprobó aparte en una transacción revertida.
- [ ] **T4 (20 min)**: documentar los eventos en el README del módulo (hecho en `docs/modules/AUDIT.md`) y avisar a Sebastián y Miguel que ya pueden engancharlos (SPEC-405). **Pendiente: el aviso.**

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–5 | Unitaria | `modules/audit/audit.service.spec.ts` |
| Escenario 3 (concurrencia) y 6 (trigger) | Integración contra Postgres (manual en el recorrido de la demo) | — |

---

## 11. Impacto en Documentación

- [x] `ENTS_REGISTRY.md`: añadir el módulo Audit y su dueño.
- [x] `docs/modules/`: README del módulo de auditoría con la lista de eventos.
- [x] `CONTRACTS.md` v0.5.

---

## 12. Preguntas Abiertas

Ninguna. Decisión: ADR-007 §8.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-27 | Revisión | Entidad alineada con `audit.audit_event` (la anterior no coincidía con ninguna columna salvo la organización); `record_hash`/`prev_hash` desde la v1 (NOT NULL y ADR-003); módulo global sin editar IAM/Files; bloqueo por organización; registro tras el commit. |
| 2026-10-29 | Víctor Chán | Implementación de T1–T3 y documentación de T4 (falta el aviso a Sebastián y Miguel). Verificación de concurrencia e inmutabilidad contra Postgres 16. Código en `ecc99e9`. |
| 2026-10-29 | Revisión PR #16 | Corrección de la cadena: `chain_seq` como orden del tip (migración `20261029090000`) en lugar de `occurred_at`/`event_id`; hash en JSON; `catch` que tolera valores no-objeto. Constraints de BD que impiden bifurcaciones, verificadas contra Postgres 16. El aviso de T4 debe incluir este cambio de esquema y de hash. |
| 2026-10-29 | Issue #17 | Outbox de reintento `audit.audit_outbox` (migración `20261029100000`), worker `AuditOutboxService`, `AuditChainWriter` compartido, indicador `audit_outbox` en `/api/health`. Escenario 4 y §8 actualizados. Pendiente: encolar dentro de la transacción de negocio (SPEC-405). |
