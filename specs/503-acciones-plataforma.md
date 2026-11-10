# SPEC-503: ACCIONES DE PLATAFORMA E INSTALACIONES

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/integration/` |
| **Requisitos Vinculados** | RF-016, RF-015 |
| **Dependencias** | SPEC-501, SPEC-803 |
| **Prioridad** | P1 |
| **Estimación** | 3 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

El Super Admin suspende o reactiva organizaciones, y atiende las solicitudes de instalación creadas en SPEC-803.

## 3. Fuera de Alcance

- Ejecutar la instalación en el servidor del cliente (ADR-003).
- Pantalla (SPEC-502).
- Editar planes (SPEC-504).

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Suspender
  Dado un Super Admin y una organización activa
  Cuando envía POST /platform/organizations/:id/suspend
  Entonces queda suspended y sus miembros reciben 401 en su siguiente solicitud
  Y se revocan sus sesiones

Escenario 2: Reactivar
  Cuando envía POST /platform/organizations/:id/reactivate sobre una suspended o cancelled
  Entonces queda active y sus miembros pueden entrar
  Y una organización reabierta sin suscripción vigente sigue con cuota 0 hasta contratar un plan

Escenario 3: Su propia organización
  Dada la organización interna del Super Admin → 422 CANNOT_SUSPEND_OWN_ORGANIZATION

Escenario 4: Listar solicitudes
  Cuando envía GET /platform/installation-requests?status=Pendiente
  Entonces recibe organización, modelo solicitado, fecha y estado

Escenario 5: Aprobar
  Cuando envía POST /platform/installation-requests/:id/approve con { operatorName, hostReference? }
  Entonces la solicitud queda Aprobada con reviewed_at y se crea una instalación "Pendiente"

Escenario 6: Rechazar
  Cuando envía .../reject
  Entonces queda Rechazada y no se crea instalación

Escenario 7: Ya revisada
  Dada una solicitud no pendiente → 409 REQUEST_ALREADY_REVIEWED

Escenario 8: Avanzar instalación
  Cuando envía PATCH /platform/installations/:id con { status }
  Entonces permite Pendiente → En proceso → Operativa o Fallida
  Y cualquier otra transición responde 422 INVALID_INSTALLATION_TRANSITION

Escenario 9: Sin permiso
  Dado un usuario que no es Super Admin → 403 PLATFORM_ADMIN_REQUIRED

Escenario 10: Auditoría
  Entonces cada acción registra un evento en la organización afectada, con el Super Admin como actor
```

## 5. Contrato de API

| Método y ruta | Entrada | Respuesta |
|---|---|---|
| `POST /platform/organizations/:id/suspend` | — | `200 { id, status }` |
| `POST /platform/organizations/:id/reactivate` | — | `200 { id, status }` |
| `GET /platform/installation-requests` | `?status` | `{ items: [...] }`; cada item añade `installationId`, `installationStatus`, `operatorName` y `hostReference` (`null` sin instalación; SPEC-502) |
| `POST /platform/installation-requests/:id/approve` | `{ operatorName, hostReference? }` | `200 { requestId, installationId }` |
| `POST /platform/installation-requests/:id/reject` | — | `200 { requestId, status }` |
| `PATCH /platform/installations/:id` | `{ status }` | `200 { id, status }` |

## 6. Datos y Esquema

Sin migración. Usa `admin.installation_request` e `admin.installation`. Valores en español según el enum existente.

## 8. Diseño Técnico

- `PlatformActionsService` y entidades de `admin.*`, protegido por `SuperAdminGuard`.
- **Transacción con `SELECT ... FOR UPDATE`** de la organización o solicitud; evita doble revisión.
- **Máquina de estados** en un mapa constante, cubierta por pruebas.
- **Eventos:** `ORGANIZATION_SUSPENDED`, `ORGANIZATION_REACTIVATED`, `INSTALLATION_REQUEST_APPROVED`, `INSTALLATION_REQUEST_REJECTED`, `INSTALLATION_STATUS_CHANGED`. `AuditResource.INSTALLATION` cabe en `varchar(20)`.
- **Cadena de auditoría:** se escribe en la organización afectada aunque el actor pertenezca a otra.
- `admin.installation_check` no se llena aquí; la comprobación vive en SPEC-802.

## 9. Plan de Tareas

- [ ] **T1 (50 min)**: Suspender y reactivar.
- [ ] **T2 (70 min)**: Solicitudes e instalaciones.
- [ ] **T3 (60 min)**: Pruebas.

**Archivos permitidos:** `integration/platform-actions.service.ts` y su spec, `integration/entities/installation.entity.ts`, `integration/entities/installation-request.entity.ts` (nuevos), `integration/platform.controller.ts`, `integration/integration.module.ts`, `iam/ports/repositories.ts`, `iam/infrastructure/typeorm-repositories.ts`, `audit/audit.types.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–10 | Unitaria | `platform-actions.service.spec.ts` |
| Escenarios 1, 2 de punta a punta | E2E con Postgres | `apps/api/test/` |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
| 2026-11-10 | Claude Code (ampliación) | Lista de solicitudes incluye la instalación asociada, aprobado por el coordinador para SPEC-502. |
