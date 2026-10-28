# SPEC-301: HISTORIAL DE OPERACIONES DE FACTURACIÓN (REGISTRO Y CONSULTA)

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (escribe dinero simulado dentro de las transacciones de registro y activación) |
| **Responsable Principal** | Anthony (Dominio Billing & Audit) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/billing/`, `apps/api/src/modules/integration/subscription.coordinator.ts` |
| **Requisitos Vinculados** | RF-013, Curso §4.2 (historial de pagos) |
| **Dependencias** | SPEC-101 (`@Roles`). **Bloquea a** 302 y 303 (302 reutiliza `recordOperation`). |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) |
| **Estimación** | 2.0 h |
| **Estado** | En revisión (reescrita 2026-10-27 según ADR-007) |

---

## 2. Objetivo

El curso exige "historial de pagos". La tabla `billing.billing_operation` existe pero **nada la escribe y no hay entidad**: una consulta devolvería siempre una lista vacía. Esta spec (a) registra una operación simulada cada vez que se crea una suscripción y (b) expone `GET /api/billing/operations`.

---

## 3. Fuera de Alcance (YAGNI)

- Comprobantes, facturas descargables, impuestos, reembolsos.
- Reconstruir el historial de organizaciones ya existentes (no tendrán filas anteriores a este cambio).
- Operaciones de tipo distinto de `charge` y `renewal` (el enum `billing.operation_type` solo admite esos dos).

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: El registro deja el primer movimiento
  Dado una organización recién registrada
  Entonces existe una operación type "charge", amount 0 (plan Demo), vinculada a su suscripción

Escenario 2: Activar un plan nuevo registra el cobro simulado
  Dado un tenant_admin que activa el plan Team (US$19.99)
  Cuando POST /api/subscriptions/activate crea la nueva suscripción
  Entonces se escribe, en la MISMA transacción, una operación "charge" con amount 19.99

Escenario 3: Reactivar el mismo plan no escribe nada
  Dado que ya tiene el plan vigente
  Cuando vuelve a activarlo (idempotente)
  Entonces no se crea ninguna operación

Escenario 4: Consulta
  Dado un tenant_admin
  Cuando envía GET /api/billing/operations
  Entonces responde 200 con items[] (id, type, planName, amount, simulated: true, occurredAt), más recientes primero, máximo 100

Escenario 5: Aislamiento
  Entonces solo aparecen operaciones de suscripciones de la organización del token

Escenario 6: Colaborador
  Entonces GET /api/billing/operations responde 403 FORBIDDEN_ROLE

Escenario 7: Atomicidad
  Dado que falla la escritura de la operación
  Entonces no queda creada la suscripción (todo se revierte junto)
```

---

## 5. Contrato de API

Ver `CONTRACTS.md` v0.5, "Facturación: historial y renovación". `GET /api/billing/operations` — `@Roles(Role.TENANT_ADMIN)`.

---

## 6. Datos y Esquema

- **¿Modifica BD?** No. Esquema real de `billing.billing_operation`: `operation_id`, `subscription_id` (FK), `type` (`charge` | `renewal`), `amount numeric(10,2)` (nullable, ≥ 0), `simulated_at`. **No tiene** organización, plan, moneda ni indicador de simulación: la organización y el plan se obtienen por `subscription_id` → `subscription.organization_id` / `plan_id`; `simulated` es siempre `true` (no hay cobro real).
- Entidad nueva `BillingOperation` en `modules/billing/entities/billing-operation.entity.ts` (`schema: 'billing'`, `name: 'billing_operation'`).
- `amount` llega de PostgreSQL como texto: convertir a número. El importe es el precio del plan en USD (`priceCents / 100`).

---

## 7. Interfaz de Usuario

Pantalla en SPEC-303.

---

## 8. Diseño Técnico

- `BillingService.recordOperation(manager, subscription, type, amount)`: inserta con el `EntityManager` recibido (misma transacción).
- **Dónde se llama:**
  1. `provisionInitialSubscription` (hook del registro): `charge` de 0 al crear Demo.
  2. `SubscriptionCoordinator.activateSubscription`: tras `manager.save(newSubscription)` y solo cuando se **crea** una suscripción. **Nota:** el coordinador hoy escribe la suscripción por su cuenta (no pasa por `BillingService.persistSubscription`); por eso el registro de la operación debe añadirse en ambos sitios o, mejor, el coordinador debe delegar en `persistSubscription` (decisión de Anthony; si se refactoriza, mantener las pruebas existentes del coordinador).
  3. `persistSubscription` cuando crea una fila nueva.
- `BillingService.listOperations(organizationId)`: `billing_operation` ⋈ `subscription` ⋈ `plan` con `subscription.organization_id = :orgId`, `ORDER BY simulated_at DESC LIMIT 100`.
- Ruta en `BillingController`: `@Get('billing/operations')` con `@UseGuards(AuthGuard('jwt'), RolesGuard)` y `@Roles(Role.TENANT_ADMIN)`. `GET /plans` sigue público.
- DTO de respuesta propio (no la entidad). Sin auditoría (lectura).
- **Riesgos:** (a) escribir la operación fuera de la transacción de la suscripción → historial inconsistente (cubierto por el escenario 7); (b) olvidar uno de los tres caminos de creación → faltan filas (cubierto por pruebas de cada camino).

---

## 9. Plan de Tareas

- [ ] **T1 (15 min)**: entidad `BillingOperation`, registrada en `BillingModule`.
- [ ] **T2 (40 min)**: `recordOperation` y su llamada en los tres caminos.
- [ ] **T3 (25 min)**: `listOperations`, DTO y ruta con `@Roles`.
- [ ] **T4 (40 min)**: pruebas (escenarios 1–7).

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1, 7 | Unitaria | `modules/billing/billing.service.spec.ts` |
| Escenarios 2, 3 | Unitaria | `modules/integration/subscription.coordinator.spec.ts` |
| Escenarios 4–6 | Unitaria | `modules/billing/billing.controller.spec.ts` |

---

## 11. Impacto en Documentación

- [x] `CONTRACTS.md` v0.5.
- [ ] `ENTS_REGISTRY.md` y `docs/modelo-minimo.md`: la entidad `BillingOperation` ya existe en el modelo; registrar su implementación.

---

## 12. Preguntas Abiertas

Ninguna. Decisión: ADR-007 §9.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-27 | Revisión | Esquema real (`type` ∈ charge/renewal, `amount` en USD, sin org/plan/moneda); detectado que nada escribe la tabla; se añade el registro en tres caminos; solo `tenant_admin`; nivel N2. |
