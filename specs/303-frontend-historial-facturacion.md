# SPEC-303: HISTORIAL DE FACTURACIÓN Y RENOVACIÓN EN SUSCRIPCIÓN

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 (Frontend / Integración) |
| **Responsable Principal** | Miguel (delegado por Víctor, ver `docs/equipo/asignaciones.md`) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/components/billing-screens.tsx` (`CurrentSubscription`), `apps/web/src/lib/api/billing.ts` |
| **Requisitos Vinculados** | RF-013, Curso §4.2 |
| **Dependencias** | SPEC-301 y 302 (API). Puede avanzar con un mock. |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) |
| **Estimación** | 1.5 h |
| **Estado** | Aprobada (2026-10-28, Víctor Chán) |

---

## 2. Objetivo

En `/suscripcion`, mostrar para el administrador la tabla de operaciones simuladas (`GET /billing/operations`) y el botón "Renovar" (`POST /subscriptions/renew`).

---

## 3. Fuera de Alcance (YAGNI)

- Comprobantes descargables, filtros y paginación.
- Pantallas de pago con tarjeta (la facturación es simulada).

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Historial
  Dado un tenant_admin en /suscripcion
  Entonces ve el plan actual y una tabla con fecha (formatIsoDate), plan, tipo ("Cobro"/"Renovación") e importe en USD, con la insignia "Simulado"

Escenario 2: Renovar
  Dado un plan con vencimiento (expiresAt no nulo)
  Cuando pulsa "Renovar" y la API responde 200
  Entonces se actualiza la fecha de vencimiento y aparece la nueva fila "Renovación"

Escenario 3: Plan sin vencimiento
  Dado el plan Demo
  Entonces NO se muestra "Renovar"

Escenario 4: Colaborador
  Entonces no se llama a la API del historial ni se muestran acciones de plan; ve "Solo los administradores gestionan la suscripción"

Escenario 5: Estados
  Entonces existen cargando, vacío ("Aún no hay movimientos"), error con reintento y datos
```

---

## 5. Contrato de API

Consume `CONTRACTS.md` v0.5. `getBillingOperations()` y `renewSubscription()` en `lib/api/billing.ts`; tipos en `lib/api/types.ts`.

---

## 6. Datos y Esquema

No aplica.

---

## 7. Interfaz de Usuario

- Componente `BillingHistoryTable`. Importe: si `lib/format.ts` o `lib/plans.ts` no tienen un formateador de USD, añadir **uno solo** en `lib/format.ts` y reutilizarlo.
- Mensajes de error por `code` (`PLAN_NOT_RENEWABLE`, `NO_ACTIVE_SUBSCRIPTION`).

---

## 8. Diseño Técnico

- El cliente decide solo qué mostrar (según `session.role` y si `plan.expiresAt` existe); no calcula vencimientos ni importes.

---

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: funciones de API y tipos.
- [ ] **T2 (45 min)**: `BillingHistoryTable` con estados y vista para `colaborador`.
- [ ] **T3 (25 min)**: botón "Renovar" con refresco.

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Verificación |
|---|---|---|
| Escenarios 1–5 | Manual | Activar Team, renovar, comprobar dos filas; probar con Demo y con un colaborador |

---

## 11. Impacto en Documentación

Ninguno.

---

## 12. Preguntas Abiertas

Ninguna.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-27 | Revisión | Añadido "Renovar"; campos del contrato; vista de colaborador; sin estado de operación (la tabla no lo guarda). |
