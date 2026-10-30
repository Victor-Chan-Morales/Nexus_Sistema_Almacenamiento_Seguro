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
| **Escenario 1** | Primera página en orden descendente, contrato público sin datos internos (`events`) y `nextBefore = null` al no superar el límite. | **PASS** | `audit.service.spec.ts` |
| **Escenario 2** | Paginación por cursor retornando `limit` elementos y asignando a `nextBefore` la fecha ISO del último evento. | **PASS** | `audit.service.spec.ts` |
| **Escenario 3** | Validación estricta de parámetros (`limit` 1–100, default 50; `before` formato ISO-8601). Retorno 400 ante valores inválidos. | **PASS** | `audit.controller.spec.ts` (validación de DTO con `class-validator`) |
| **Escenario 4** | Aislamiento multi-tenant estricto mediante filtrado obligatorio por `organizationId` de la sesión JWT. | **PASS** | `audit.service.spec.ts` |
| **Escenario 5** | Control de acceso restringido con exclusividad al rol `tenant_admin`. | **PASS** | Metadatos `@Roles` verificados vía `Reflector` en `audit.controller.spec.ts`; rechazo HTTP 401 en vivo ante peticiones anónimas |
| **Escenario 6** | Sanitización y exclusión categórica de metadatos criptográficos internos (`recordHash`, `prevHash`, `correlationId`, `safeReason`). | **PASS** | `audit.service.ts` / `audit.service.spec.ts` |

---

## 2. Compilación y Configuración de Tipos

- **Comprobación estricta de tipos:** `npx tsc --noEmit` ejecutado en `apps/api` finalizado con **0 errores**.
- **Empaquetado de producción:** `nest build` completado satisfactoriamente en `dist/`.
- **Justificación de `apps/api/tsconfig.json`:** Se incluyó `"types": ["node", "jest"]` para que el compilador resuelva las declaraciones globales de pruebas (`jest`, `describe`, `expect`) en los archivos `*.spec.ts` dentro de `src/`, manteniendo la configuración sin espacios ni líneas sobrantes.
- **Registro en Módulo:** `AuditController` registrado formalmente en `AuditModule.controllers`.

---

## 3. Pruebas de Integración y Seguridad HTTP en Vivo

Servidor ejecutándose en `http://localhost:3001/api`:

- **Petición sin cabecera de autenticación (`GET /api/audit/events`):** Retorna HTTP `401 Unauthorized` interceptado por `AuthGuard('jwt')`.
- **Petición con límite excedido (`limit=150`):** Rechazada por el DTO mediante `Max(100)` con HTTP `400 Bad Request`.
- **Petición con cursor inválido (`before=fecha-invalida`):** Rechazada por el DTO mediante `IsISO8601()` con HTTP `400 Bad Request`.

---

## 4. Evidencia de Ejecución de Suites de Pruebas Automatizadas

### A. Dominio de Auditoría (`apps/api`) — 61 pruebas unitarias en verde
*(Se removió el bloque duplicado `computeRecordHash` en `audit.service.spec.ts`, estabilizando el total real del módulo en 61 pruebas).*

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
      √ Escenario 4: Aplica where organizationId aislando eventos de otros tenants
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
    √ Delega la consulta al servicio con el organizationId de la sesión
    √ Lanza ForbiddenException si la sesión no contiene un organizationId
    Escenario 3: Validación de límites en query DTO
      √ valida que limit por defecto sea 50 y acepte valores entre 1 y 100 con fecha ISO
      √ falla validación si limit es menor a 1, mayor a 100 o before no es ISO

Test Suites: 4 passed, 4 total
Tests:       61 passed, 61 total
Snapshots:   0 total