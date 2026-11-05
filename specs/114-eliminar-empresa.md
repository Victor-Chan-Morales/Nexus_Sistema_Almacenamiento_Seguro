# SPEC-114: ELIMINAR EMPRESA (BLOQUEAR Y CONSERVAR)

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (acción crítica sobre toda la organización) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/iam/`, `apps/api/src/modules/integration/`, `apps/web/src/app/configuracion/` |
| **Requisitos Vinculados** | Administración §8; ADR-008 §6 |
| **Dependencias** | SPEC-108 |
| **Prioridad** | P1 |
| **Estimación** | 2.5 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Un administrador puede cerrar su organización: nadie vuelve a entrar, se cancela la suscripción y **todos los archivos se conservan**.

## 3. Fuera de Alcance

- Borrado físico o periodo de gracia.
- Reactivar: lo hace un Super Admin en SPEC-503.
- Eliminar únicamente una cuenta de usuario: es SPEC-108.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Cierre exitoso
  Dado un tenant_admin
  Cuando envía POST /organizations/close con el nombre exacto de la organización y su contraseña
  Entonces la organización queda cancelled y su suscripción activa cancelled
  Y se revocan las sesiones de todos sus miembros
  Y responde 200 y limpia la cookie de refresco

Escenario 2: Acceso bloqueado
  Dada una organización cerrada
  Entonces cualquier miembro recibe 401 en sus solicitudes
  Y no puede iniciar sesión

Escenario 3: Archivos conservados
  Entonces permanecen las filas de archivos, versiones y sus objetos en el almacén
  Y la purga automática de papelera no toca organizaciones cerradas

Escenario 4: Datos incorrectos
  Dado un nombre distinto → 422 ORGANIZATION_NAME_MISMATCH
  Dada una contraseña incorrecta → 401 INVALID_CREDENTIALS
  Y no cambia nada

Escenario 5: Permisos
  Dado un colaborador → 403 FORBIDDEN_ROLE

Escenario 6: Pantalla
  Dado un tenant_admin en /configuracion
  Cuando abre "Eliminar empresa"
  Entonces debe escribir el nombre y su contraseña en un diálogo
  Y al terminar se cierra su sesión y ve un mensaje de confirmación
```

## 5. Contrato de API

`POST /organizations/close`, `tenant_admin`, cuerpo `{ organizationName, password }` → `200 { closed: true }`. Error nuevo: `422 ORGANIZATION_NAME_MISMATCH`.

## 6. Datos y Esquema

Sin migración. Usa `admin.organization.status`, `billing.subscription.status`, `iam.session.revoked_at`.

## 7. Interfaz de Usuario

Sección "Zona de riesgo" en `/configuracion`, visible solo para `tenant_admin`. Reutilizar `Dialog`.

## 8. Diseño Técnico

- **Orquestación:** `OrganizationClosureService` en `modules/integration/` (IAM no conoce Billing).
- **Transacción única:** `organizations.lockById` → verificar nombre → estado `cancelled` → `BillingService.cancelActive(org, manager)` (nuevo) → revocar sesiones de todos sus miembros.
- La contraseña se verifica **antes** de la transacción (Argon2 es costoso).
- **Auditoría, tras el commit:** `ORGANIZATION_CLOSED`, `AuditResource.ORGANIZATION`.
- **Bloqueo:** ya lo aplica `findActive`, que exige organización activa.
- **Error en pantalla:** aquí `401 INVALID_CREDENTIALS` significa contraseña incorrecta, no sesión vencida. La pantalla revisa `code` antes de llamar a `failSession`, que cierra la sesión ante cualquier `401`.
- **Limitación de ADR-007 §5:** un correo sigue ocupado tras el cierre y no puede registrarse otra vez.

## 9. Plan de Tareas

- [ ] **T1 (30 min)**: Ruta, DTO y errores.
- [ ] **T2 (50 min)**: `OrganizationClosureService` y `cancelActive`.
- [ ] **T3 (40 min)**: Pantalla.
- [ ] **T4 (30 min)**: Pruebas.

**Archivos permitidos:** `integration/organization-closure.service.ts` y su spec (nuevos), `integration/organizations.controller.ts` (nuevo), `integration/integration.module.ts`, `billing/billing.service.ts` (solo `cancelActive`), `iam/ports/repositories.ts`, `iam/infrastructure/typeorm-repositories.ts`, `audit/audit.types.ts`, `app/configuracion/page.tsx`, `lib/api/members.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1, 4, 5 | Unitaria | `organization-closure.service.spec.ts` |
| Escenarios 2, 3 | E2E con Postgres | `apps/api/test/` |
| Escenario 6 | Manual | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6.
- [ ] `BUSINESS_RULES.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
| 2026-11-04 | Claude Code (revisión) | Se aclara cómo distingue la pantalla una contraseña incorrecta de una sesión vencida. Aprobado por el coordinador (2026-11-04). |
