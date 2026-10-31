# Evidencia de Validación: SPEC-402 (Consulta de Eventos de Auditoría)

- **Requisito del Sistema:** RF-012 (Consulta de Bitácora Inmutable)
- **Ruta implementada:** `GET /api/audit/events`
- **Contrato:** `CONTRACTS.md` v0.5 (`{ events: [...], nextBefore }`)
- **Módulo:** `apps/api/src/modules/audit`
- **Dueño del Módulo:** Anthony (Responsable: Miguel, ver `docs/equipo/asignaciones.md`)
- **Autor:** René Montenegro (@rmonteblack)
- **Aprobador Requerido:** @Victor-Chan-Morales (Coordinador General)
- **Rama:** `feat/402-consulta-auditoria`
- **Fecha de validación:** 30 de octubre de 2026
- **Estado:** Listo para Revisión (Pendiente de Aprobación del Coordinador)

---

## 1. Cumplimiento de Criterios de Aceptación (Gherkin)

| Escenario | Criterio de la Spec | Estado | Componente Validador |
|---|---|:---:|---|
| **Escenario 1** | Primera página en orden `occurredAt DESC, eventId DESC`, contrato público (`events`) y `nextBefore = null` al no superar el límite. | **PASS** | `audit.service.spec.ts` (orden, `take(limit + 1)` y `nextBefore`) |
| **Escenario 2** | Paginación por cursor: `limit` elementos, `nextBefore` = `occurredAt` del último, y `before` aplica `occurredAt < :before`. | **PASS** | `audit.service.spec.ts` (página completa y filtro `before`) |
| **Escenario 3** | `limit` por defecto 50 y rango 1–100; `before` ISO-8601; valores inválidos → 400. | **PASS** | `audit.controller.spec.ts` (default, bordes 1 y 100, rechazo de 0 y 101, `before` ISO) |
| **Escenario 4** | Aislamiento multi-tenant mediante filtro obligatorio por `organizationId` de la sesión JWT. | **PASS** | `audit.service.spec.ts` |
| **Escenario 5** | Acceso exclusivo a `tenant_admin`: `@Roles` verificado con `Reflector`, `colaborador` recibe 403 `FORBIDDEN_ROLE` al ejecutar el `RolesGuard` real, y 401 en vivo ante peticiones anónimas. | **PASS** | `audit.controller.spec.ts` (guard con contexto simulado) |
| **Escenario 6** | La respuesta solo expone `id`, `action`, `resourceType`, `resourceId`, `actorId`, `result` y `occurredAt`; no incluye `recordHash`, `prevHash`, `correlationId` ni `safeReason`. | **PASS** | `audit.service.spec.ts` (claves exactas y ausencia de valores internos) |

---

## 2. Compilación y Configuración de Tipos

- **Comprobación estricta de tipos:** `npx tsc --noEmit` ejecutado en `apps/api` finalizado con **0 errores**.
- **Empaquetado de producción:** `nest build` completado satisfactoriamente en `dist/`.
- **`apps/api/tsconfig.json`:** sin cambios respecto a `main`. La PR no modifica la configuración de TypeScript.
- **Registro en Módulo:** `AuditController` registrado formalmente en `AuditModule.controllers`.

---

## 3. Pruebas de Integración y Seguridad HTTP en Vivo

Servidor ejecutándose en `http://localhost:3001/api`:

- **Petición sin cabecera de autenticación (`GET /api/audit/events`):** Retorna HTTP `401 Unauthorized` interceptado por `AuthGuard('jwt')`.
- **Petición con límite excedido (`limit=150`):** Rechazada por el DTO mediante `Max(100)` con HTTP `400 Bad Request`.
- **Petición con cursor inválido (`before=fecha-invalida`):** Rechazada por el DTO mediante `IsISO8601()` con HTTP `400 Bad Request`.

> Nota: estas pruebas en vivo las ejecutó el autor antes de la revisión de formato y pruebas. Los cambios posteriores no modifican la lógica HTTP. No se repitieron en la revisión porque requieren servidor y base de datos en ejecución.

---

## 4. Evidencia de Ejecución de Suites de Pruebas Automatizadas

### A. Dominio de Auditoría (`apps/api`) — 70 pruebas unitarias en verde

```text
PASS src/modules/audit/audit-error-code.spec.ts
PASS src/modules/audit/audit-outbox.service.spec.ts
PASS src/modules/audit/audit.service.spec.ts
  AuditService — Pruebas unitarias del registro encadenado (SPEC-401)
    Escenario 1: registro de un evento
      √ inserta una fila con los campos de la spec y prev_hash nulo en el primer evento
      √ usa el correlationId recibido cuando se proporciona
    Escenario 2: encadenamiento
      √ toma el record_hash del último evento de la organización como prev_hash
      √ consulta el último evento por chain_seq filtrando por la organización del evento
      √ otra organización sin eventos empieza su propia cadena con prev_hash nulo y chain_seq 1
    Escenario 3: eventos concurrentes
      √ toma el bloqueo consultivo por organización antes de leer la cadena y fijar occurred_at
    Escenario 3b: cadena lineal con eventos concurrentes en el mismo milisegundo
      √ 20 registros simultáneos de una organización forman una sola cadena sin bifurcaciones
    Escenario 4: nunca bloquea la operación
      √ no propaga el error si el INSERT falla y registra solo el código, sin datos del evento
      √ si el INSERT falla, encola el evento con el mismo event_id y correlation_id que intentó
      √ un fallo permanente se encola directamente como dead, con su código
      √ no encola cuando el registro directo funciona
      √ no propaga el error si la transacción no puede abrirse
      √ no propaga un fallo lanzado como undefined
      √ no propaga un fallo lanzado como null
    Escenario 5: sin datos sensibles
      √ la fila insertada solo contiene columnas de la tabla, sin campos libres
    listEvents (SPEC-402)
      √ Escenario 1: Devuelve eventos de la org en orden descendente con nextBefore = null si no supera el límite
      √ Escenario 2: Devuelve limit registros y nextBefore = occurredAt del último cuando hay más páginas
      √ Escenario 2: con before filtra por occurredAt anterior al cursor
      √ Escenario 4: Aplica where organizationId aislando eventos de otros tenants
      √ Escenario 6: la respuesta solo expone los campos públicos
  computeRecordHash
    √ es determinista para los mismos campos
    √ produce un SHA-256 hexadecimal de 64 caracteres
    √ cambia cuando cambia prevHash
    √ cambia cuando cambia chainSeq
    √ cambia cuando cambia eventId
    √ cambia cuando cambia organizationId
    √ cambia cuando cambia actorId
    √ cambia cuando cambia actionType
    √ cambia cuando cambia resourceType
    √ cambia cuando cambia resourceId
    √ cambia cuando cambia safeReason
    √ cambia cuando cambia correlationId
    √ cambia cuando cambia occurredAt
    √ no colisiona cuando un valor contiene el separador que usaba la versión anterior
    √ trata prevHash nulo y vacío igual y distinto de un hash real

PASS src/modules/audit/audit.controller.spec.ts
  AuditController (SPEC-402)
    √ Escenario 5: El endpoint getEvents está restringido exclusivamente a TENANT_ADMIN
    √ Escenario 5: un colaborador recibe 403 con código FORBIDDEN_ROLE
    √ Escenario 5: un tenant_admin supera el RolesGuard
    √ Delega la consulta al servicio con el organizationId de la sesión
    √ Lanza ForbiddenException si la sesión no contiene un organizationId
    Escenario 3: Validación de límites en query DTO
      √ usa 50 como limit por defecto cuando el parámetro no se envía
      √ acepta limit = 1
      √ acepta limit = 100
      √ rechaza limit = 0
      √ rechaza limit = 101
      √ rechaza before que no es ISO-8601
      √ acepta before ISO-8601

Test Suites: 4 passed, 4 total
Tests:       70 passed, 70 total
Snapshots:   0 total
```

### B. Suite completa de la API (`apps/api`)

```text
Test Suites: 17 passed, 17 total
Tests:       167 passed, 167 total
Snapshots:   0 total
```
