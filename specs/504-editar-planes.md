# SPEC-504: EDITAR EL CATÁLOGO DE PLANES

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (planes y cuotas) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/billing/`, `apps/web/src/components/platform-console.tsx` |
| **Requisitos Vinculados** | RF-016, Roles §7 |
| **Dependencias** | SPEC-501, SPEC-502 |
| **Prioridad** | P2 |
| **Estimación** | 1 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

El Super Admin ajusta precio y límites sin tocar la base de datos.

## 3. Fuera de Alcance

- Crear o eliminar planes y versionar precios.
- Cambiar el plan Demo, del que depende el registro.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Editar
  Cuando un Super Admin envía PATCH /platform/plans/:id con precio o límites válidos
  Entonces responde 200 y GET /plans refleja el cambio

Escenario 2: Reducir por debajo del uso
  Dada una organización suscrita cuyo uso supere el nuevo límite
  Entonces responde 422 PLAN_LIMIT_BELOW_USAGE

Escenario 3: Plan Demo → 422 PLAN_NOT_EDITABLE

Escenario 4: Valores inválidos → 400 VALIDATION_ERROR

Escenario 5: Sin permiso → 403 PLATFORM_ADMIN_REQUIRED

Escenario 6: Auditoría → PLAN_UPDATED

Escenario 7: Pantalla
  Entonces la consola muestra un formulario de edición por plan
```

## 5. Contrato de API

`PATCH /platform/plans/:id` `{ priceMonthly?, storageLimitGb?, userLimit?, description? }` → plan actualizado.

## 6. Datos y Esquema

Sin migración.

## 8. Diseño Técnico

Validar en una transacción. El historial conserva `amount` por operación, así que no se altera el pasado.

## 9. Plan de Tareas

- [ ] **T1 (30 min)**: Servicio, validaciones y auditoría.
- [ ] **T2 (30 min)**: Pantalla y pruebas.

**Archivos permitidos:** `billing/billing.service.ts`, `integration/platform.controller.ts`, `integration/platform-admin.service.ts`, sus specs, `audit/audit.types.ts`, `components/platform-console.tsx`, `lib/api/platform.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–6 | Unitaria | `platform-admin.service.spec.ts` |
| Escenario 7 | Manual | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
