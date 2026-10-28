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
| **Estado** | En revisión (reescrita 2026-10-27 según ADR-007) |

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

- **¿Modifica BD?** No. Esquema real de `audit.audit_event`:

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
| `prev_hash`, `record_hash` | varchar(128) | `record_hash` NOT NULL y no vacío |
| `occurred_at` | timestamptz NOT NULL | |

- La entidad TypeORM va con `@Entity({ schema: 'audit', name: 'audit_event' })` (la versión anterior de la spec omitía el esquema, lo que apuntaría a `public`) y los enum como `enum` con `enumName`, igual que `subscription.entity.ts`. **No** tiene `metadata`, `ip_address`, `user_id` ni `created_at`.

---

## 7. Interfaz de Usuario

No aplica.

---

## 8. Diseño Técnico

- `AuditModule` marcado `@Global()` y exportando `AuditService`: IAM, Files y Billing lo inyectan sin importarlo y **sin dependencia circular** (AuditModule no importa ningún módulo de dominio).
- **`logEvent`:** abre su propia transacción: `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))` con el `organizationId` → leer el último `record_hash` de la organización (`ORDER BY occurred_at DESC, event_id DESC LIMIT 1`) → fijar `occurred_at = new Date()` **dentro del bloqueo** → calcular el hash → insertar. Todo envuelto en `try/catch`.
- **Hash:** `record_hash = sha256_hex( [prev_hash ?? '', event_id, organization_id, actor_type, actor_id ?? '', action_type, resource_type ?? '', resource_id ?? '', result, correlation_id, occurred_at.toISOString()].join('|') )`. Función pura y testeable (`computeRecordHash`).
- **Cuándo se llama:** después del commit de la operación principal, nunca dentro de su transacción (un error SQL dentro de ella la abortaría).
- **Riesgos:** (a) bifurcación de la cadena con inserciones concurrentes → bloqueo consultivo; (b) un fallo de auditoría rompiendo la operación del usuario → `logEvent` no lanza; (c) filtrar datos sensibles → el tipo de entrada no admite campos libres.

---

## 9. Plan de Tareas

- [ ] **T1 (30 min)**: entidad (esquema `audit`), enums de acción/recurso y `AuditModule` global registrado en `AppModule`.
- [ ] **T2 (50 min)**: `AuditService.logEvent` con bloqueo, cadena y `try/catch`; `computeRecordHash`.
- [ ] **T3 (50 min)**: pruebas (escenarios 1–6; hash determinista; cadena por organización; el error no se propaga).
- [ ] **T4 (20 min)**: documentar los eventos en el README del módulo y avisar a Sebastián y Miguel que ya pueden engancharlos (SPEC-405).

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–5 | Unitaria | `modules/audit/audit.service.spec.ts` |
| Escenario 3 (concurrencia) y 6 (trigger) | Integración contra Postgres (manual en el recorrido de la demo) | — |

---

## 11. Impacto en Documentación

- [ ] `ENTS_REGISTRY.md`: añadir el módulo Audit y su dueño.
- [ ] `docs/modules/`: README del módulo de auditoría con la lista de eventos.
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
