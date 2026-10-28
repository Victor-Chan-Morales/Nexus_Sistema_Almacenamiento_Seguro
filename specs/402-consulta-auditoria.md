# SPEC-402: CONSULTA DE EVENTOS DE AUDITORÍA

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 |
| **Responsable Principal** | Miguel (delegado; Anthony es dueño de `modules/audit/`: **excepción de propiedad solo para esta spec**, tras el merge de SPEC-401) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/audit/` |
| **Requisitos Vinculados** | RF-012 |
| **Dependencias** | SPEC-401 y SPEC-101 (`@Roles`). |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) |
| **Estimación** | 1.5 h |
| **Estado** | Aprobada (2026-10-28, Víctor Chán) |

---

## 2. Objetivo

`GET /api/audit/events` devuelve la bitácora de la organización, más reciente primero, con paginación por cursor, **solo para `tenant_admin`**.

---

## 3. Fuera de Alcance (YAGNI)

- Filtros en el servidor, búsqueda, exportación y verificación de integridad (SPEC-404).
- Resolver el nombre del actor en el servidor: el frontend lo resuelve con `GET /organizations/members` (misma audiencia).

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Primera página
  Dado 15 eventos de la organización y un tenant_admin
  Cuando envía GET /api/audit/events
  Entonces responde 200 con los 15 eventos por occurredAt descendente (id, action, resourceType, resourceId, actorId, result, occurredAt)
  Y nextBefore = null

Escenario 2: Paginación
  Dado 120 eventos y limit = 50
  Entonces devuelve 50 y nextBefore = occurredAt del último
  Y GET ...?before=<nextBefore> devuelve los siguientes

Escenario 3: Límites
  Entonces limit por defecto 50, máximo 100; limit fuera de 1–100 o before no ISO → 400 VALIDATION_ERROR

Escenario 4: Aislamiento
  Entonces nunca se devuelven eventos de otra organización

Escenario 5: Rol
  Dado un colaborador, entonces responde 403 FORBIDDEN_ROLE

Escenario 6: Sin datos internos
  Entonces la respuesta no incluye record_hash, prev_hash, correlation_id ni safe_reason
```

---

## 5. Contrato de API

Ver `CONTRACTS.md` v0.5, "Auditoría". `GET /api/audit/events?limit=50&before=<ISO-8601>` — `@Roles(Role.TENANT_ADMIN)`. La respuesta usa `action` (no `actionType`), `occurredAt` (no `timestamp`/`createdAt`) y **no** incluye `metadata`: la tabla no la tiene.

---

## 6. Datos y Esquema

- **¿Modifica BD?** No. Usa el índice `ix_audit_event_organization_occurred_at (organization_id, occurred_at DESC)`.

---

## 7. Interfaz de Usuario

Pantalla en SPEC-403.

---

## 8. Diseño Técnico

- `AuditService.listEvents(organizationId, { limit, before })`: `WHERE organization_id = :org [AND occurred_at < :before] ORDER BY occurred_at DESC, event_id DESC LIMIT limit + 1`; si vuelve un registro de más, hay `nextBefore`.
- `AuditController` (`@Controller('audit')`) con `@UseGuards(AuthGuard('jwt'), RolesGuard)` y `@Roles(Role.TENANT_ADMIN)`. Usa `AuthGuard('jwt')` como `DashboardController`, **sin importar `IamModule`** (evita un ciclo con el módulo global).
- **Limitación del cursor:** `nextBefore` es solo `occurredAt`, así que dos eventos de la misma organización con idéntico `occurredAt` (mismo milisegundo) en el límite entre páginas podrían omitirse. Es improbable (los eventos de una organización se serializan) y se acepta en este corte; un cursor compuesto `(occurredAt, id)` requeriría cambiar el contrato.
- DTO de consulta (`@IsOptional @IsInt @Min(1) @Max(100) limit`, `@IsOptional @IsISO8601 before`) y DTO de respuesta propio.

---

## 9. Plan de Tareas

- [ ] **T1 (30 min)**: `listEvents` con cursor.
- [ ] **T2 (20 min)**: controlador, DTOs y `@Roles`.
- [ ] **T3 (35 min)**: pruebas (escenarios 1–6).

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–4, 6 | Unitaria | `modules/audit/audit.service.spec.ts` |
| Escenarios 3 y 5 | Unitaria | `modules/audit/audit.controller.spec.ts` |

---

## 11. Impacto en Documentación

- [x] `CONTRACTS.md` v0.5.

---

## 12. Preguntas Abiertas

Ninguna.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-28 | Revisión | Declarada la limitación del cursor por `occurredAt`. |
| 2026-10-27 | Revisión | Solo `tenant_admin` (no existe el rol auditor); sin `metadata`; `occurredAt`; paginación por cursor; sin campos internos. |
