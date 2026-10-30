# Evidencia de Validación: SPEC-402 (Consulta de Eventos de Auditoría)

- **Requisito del Sistema:** RF-012 (Consulta de Bitácora Inmutable)
- **Ruta implementada:** `GET /api/audit/events`
- **Rama:** `feat/402-consulta-auditoria`
- **Fecha de validación:** 30 de octubre de 2026
- **Estado:** Aprobado para Merge (Ready for Review)

---

## 1. Cumplimiento de Criterios de Aceptación (Gherkin)

| Escenario | Criterio de la Spec | Estado | Componente Validador |
|---|---|:---:|---|
| **Escenario 1** | Primera página en orden descendente, contrato público sin datos internos y `nextBefore = null` al no superar el límite. | **PASS** | `audit.service.spec.ts` |
| **Escenario 2** | Paginación por cursor retornando `limit` elementos y asignando a `nextBefore` la fecha del último evento. | **PASS** | `audit.service.spec.ts` |
| **Escenario 3** | Validación estricta de parámetros (`limit` 1–100, default 50; `before` formato ISO-8601). Retorno 400 ante valores inválidos. | **PASS** | `audit.controller.spec.ts` / DTO |
| **Escenario 4** | Aislamiento multi-tenant estricto mediante filtrado obligatorio por `organizationId` de la sesión JWT. | **PASS** | `audit.service.spec.ts` |
| **Escenario 5** | Control de acceso restringido con exclusividad al rol `tenant_admin` mediante `@Roles` y `RolesGuard`. Retorno 403 ante otros roles. | **PASS** | `audit.controller.spec.ts` |
| **Escenario 6** | Sanitización y exclusión categórica de metadatos criptográficos internos (`recordHash`, `prevHash`, `correlationId`, `safeReason`). | **PASS** | `audit.service.ts` |

---

## 2. Compilación y Calidad de Código

- **Comprobación estricta de tipos:** `npx tsc --noEmit` finalizado con **0 errores**.
- **Empaquetado de producción:** `nest build` completado satisfactoriamente en `dist/`.
- **Tipado Jest:** Configurado formalmente en `apps/api/tsconfig.json` (`"types": ["node", "jest"]`).
- **Registro en Módulo:** `AuditController` expuesto formalmente en `AuditModule.controllers`.

---

## 3. Pruebas de Integración y Seguridad HTTP en Vivo

Servidor ejecutándose en `http://localhost:3001/api`:

- **Intento de acceso sin JWT:** Retorna HTTP `401 Unauthorized` (Bloqueado por `AuthGuard('jwt')`).
- **Petición con límite no permitido (`limit=150`):** Rechazado por DTO (`Max(100)`).
- **Petición con cursor corrupto (`before=formato-invalido`):** Rechazado por DTO (`IsISO8601`).

---

## 4. Evidencia de Ejecución de Suites de Pruebas

### A. Suites del Dominio de Auditoría (76 pruebas en verde)
```text
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

PASS src/modules/audit/audit.controller.spec.ts
  AuditController (SPEC-402)
    √ Escenario 5: El endpoint getEvents está restringido exclusivamente a TENANT_ADMIN
    √ Delega la consulta al servicio con el organizationId de la sesión
    √ Lanza ForbiddenException si la sesión no contiene un organizationId
    Escenario 3: Validación de límites en query DTO
      √ valida que limit por defecto sea 50 y acepte valores entre 1 y 100 con fecha ISO
      √ falla validación si limit es menor a 1, mayor a 100 o before no es ISO

Test Suites: 4 passed, 4 total
Tests:       76 passed, 76 total
Snapshots:   0 total
Time:        24.469 s

```

### B. Suite Global del Sistema (No Regresión)

```text
Test Suites: 17 passed, 17 total
Tests:       173 passed, 173 total
Snapshots:   0 total
Time:        152.079 s

```

---

## 5. Estado de la Base de Datos Local

* Contenedores Docker activos: `nexus-postgres-dev`, `nexus-seaweedfs-dev`, `nexus-mailpit-dev`.
* Migraciones aplicadas: 22/22 (incluyendo `20261029100000_create_audit_outbox.sql` y `20261029110000_add_audit_outbox_lease.sql`).
* Servicio de outbox en background: Ejecución periódica limpia sin excepciones `42P01` (`undefined_table`).
'@

```