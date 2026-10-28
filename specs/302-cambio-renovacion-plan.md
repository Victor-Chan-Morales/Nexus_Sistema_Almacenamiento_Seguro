# SPEC-302: RENOVACIÓN DE LA SUSCRIPCIÓN

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (transaccionalidad de suscripciones y dinero simulado) |
| **Responsable Principal** | Anthony (Dominio Billing & Audit) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/billing/` y `apps/api/src/modules/integration/subscriptions.controller.ts` (acuerdo explícito de Víctor: Anthony edita este controlador solo para esta spec) |
| **Requisitos Vinculados** | RF-013, Curso §4.2 (renovación de servicios) |
| **Dependencias** | SPEC-101 (`@Roles`) y SPEC-301 (`recordOperation`). |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) |
| **Estimación** | 1.5 h |
| **Estado** | En revisión (reescrita 2026-10-27 según ADR-007) |

---

## 2. Objetivo

El curso exige "renovación de servicios". El cambio de plan **ya existe** en `POST /subscriptions/activate` (el coordinador reemplaza la suscripción y rechaza reducciones con `422 STORAGE_QUOTA_EXCEEDED`), así que esta spec ya **no** define un "cambio de plan": añade `POST /api/subscriptions/renew`, que extiende la vigencia de la suscripción actual. El contrato establece que reactivar el mismo plan no crea ni extiende nada; por eso la renovación necesita su propia ruta.

Además aplica `@Roles(Role.TENANT_ADMIN)` a `activate` (ADR-007 §4).

---

## 3. Fuera de Alcance (YAGNI)

- Renovación automática, recordatorios de vencimiento y periodos de gracia.
- Renovar un plan ya vencido: la suscripción vencida deja de ser vigente; se vuelve a contratar con `activate`.
- Cambiar de plan mediante `renew`.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Renovación exitosa
  Dado un tenant_admin con el plan Team vigente (vence el 2026-11-10, validityDays 30)
  Cuando envía POST /api/subscriptions/renew
  Entonces responde 200 con { subscriptionId, status: "active", simulated: true, startDate, endDate }
  Y endDate = max(hoy, 2026-11-10) + 30 días
  Y NO se crea otra suscripción (mismo subscriptionId)
  Y se escribe una operación "renewal" con amount 19.99 en la misma transacción

Escenario 2: Plan sin vigencia
  Dado el plan Demo (validityDays null)
  Entonces responde 422 PLAN_NOT_RENEWABLE y no escribe nada

Escenario 3: Sin suscripción vigente
  Dado una suscripción vencida o inexistente
  Entonces responde 422 NO_ACTIVE_SUBSCRIPTION

Escenario 4: Rol
  Dado un colaborador, entonces POST /api/subscriptions/renew responde 403 FORBIDDEN_ROLE
  Y POST /api/subscriptions/activate también responde 403 FORBIDDEN_ROLE (cambio respecto de v0.4)

Escenario 5: Concurrencia
  Dado dos renovaciones simultáneas
  Entonces se serializan por bloqueo pesimista de la suscripción y cada una suma su periodo y escribe su operación

Escenario 6: Aislamiento
  Entonces solo se renueva la suscripción de la organización del token
```

---

## 5. Contrato de API

Ver `CONTRACTS.md` v0.5. `POST /api/subscriptions/renew` (sin cuerpo; `tenant_admin`). Respuesta idéntica a `activate`: `status` en minúsculas (`"active"`), `simulated: true`. Identificador de plan: siempre `planId` (el catálogo no tiene "código de plan").

---

## 6. Datos y Esquema

- **¿Modifica BD?** No. Actualiza `billing.subscription.end_date` (fecha exclusiva; `CHECK end_date >= start_date`) y escribe en `billing.billing_operation` (`type = 'renewal'`, `amount = priceCents/100`).

---

## 7. Interfaz de Usuario

Botón "Renovar" en SPEC-303.

---

## 8. Diseño Técnico

- `BillingService.renewSubscription(organizationId, manager?)`: en una transacción, bloquear (`pessimistic_write`) la suscripción activa; si no hay o su fecha ya pasó → `422 NO_ACTIVE_SUBSCRIPTION`; si el plan no tiene `validityDays` → `422 PLAN_NOT_RENEWABLE`; calcular el nuevo fin; guardar; `recordOperation(manager, sub, 'renewal', price)`.
- No pasa por el coordinador: renovar no cambia el límite de almacenamiento, así que no hay que consultar a Files.
- `SubscriptionsController`: añadir `@Post('renew')` y `@UseGuards(AuthGuard('jwt'), RolesGuard)` + `@Roles(Role.TENANT_ADMIN)` también sobre `activate`.
- **Auditoría:** `PLAN_ACTIVATED` y `PLAN_RENEWED` (SPEC-405).
- **Riesgos:** (a) sumar días sobre un fin ya pasado → por eso `max(hoy, fin actual)`; (b) fechas de solo día en UTC (`dateOnly`): usar la misma conversión que `persistSubscription`.

---

## 9. Plan de Tareas

- [ ] **T1 (40 min)**: `renewSubscription` con bloqueo, validaciones y operación.
- [ ] **T2 (20 min)**: ruta `POST /subscriptions/renew` y `@Roles` en `activate`.
- [ ] **T3 (30 min)**: pruebas (escenarios 1–6).

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–3, 5, 6 | Unitaria | `modules/billing/billing.service.spec.ts` |
| Escenario 4 | Unitaria | `modules/integration/subscriptions.controller.spec.ts` (nuevo) |

---

## 11. Impacto en Documentación

- [x] `CONTRACTS.md` v0.5.
- [ ] `docs/PROPUESTA_PLANES_PRECIOS.md`: aclarar la renovación.

---

## 12. Preguntas Abiertas

Ninguna. Decisión: ADR-007 §9. SPEC-304 (bloqueo de reducción) queda cubierta por el coordinador existente.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial ("cambio y renovación"). |
| 2026-10-27 | Revisión | Retirado `POST /subscriptions/change` (duplicaba `activate`); ahora es solo renovación; `planId` (no `planCode`); `status` en minúsculas; `STORAGE_QUOTA_EXCEEDED` para reducciones; `@Roles` en `activate`; controlador real (`subscriptions.controller.ts`). |
