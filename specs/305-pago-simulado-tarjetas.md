# SPEC-305: PAGO SIMULADO CON TARJETAS DE PRUEBA

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (facturación y migración) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/billing/`, `apps/api/src/modules/integration/`, `apps/web/src/components/billing-screens.tsx` |
| **Requisitos Vinculados** | RF-013, Curso §4.2; ADR-008 §5 |
| **Dependencias** | SPEC-004 |
| **Prioridad** | P1 |
| **Estimación** | 2.5 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Al contratar o renovar, un formulario solicita una tarjeta ficticia: una se aprueba y otra se rechaza. No hay dinero real ni se guardan datos de tarjeta.

## 3. Fuera de Alcance

- Pasarelas reales, tarjetas guardadas, reembolsos o impuestos.
- Comprobantes (SPEC-306).

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Tarjeta aprobada
  Dado un plan con precio > 0
  Cuando envía POST /subscriptions/activate con planId y la tarjeta 4242 4242 4242 4242
  Entonces se activa el plan y la operación guarda card_last4 = "4242"

Escenario 2: Tarjeta rechazada
  Dada la tarjeta 4000 0000 0000 0002
  Entonces responde 402 PAYMENT_DECLINED y no cambia la suscripción ni el historial
  Y se registra PAYMENT_DECLINED en auditoría con resultado failure

Escenario 3: Otra tarjeta
  Dado cualquier otro número
  Entonces responde 422 TEST_CARD_REQUIRED, sin procesar
  Y el mensaje advierte no usar tarjetas reales

Escenario 4: Renovar
  Cuando envía POST /subscriptions/renew con tarjeta aprobada → renueva
  Con la rechazada → 402 y la vigencia no cambia

Escenario 5: Plan gratuito o idempotente
  Dado un plan de US$0 o reactivar el plan vigente
  Entonces no exige tarjeta

Escenario 6: Falta la tarjeta
  Dado un plan con precio > 0 sin payment → 400 VALIDATION_ERROR

Escenario 7: Cuota primero
  Dado un cambio a un plan menor que no cabe
  Entonces responde 422 STORAGE_QUOTA_EXCEEDED antes de simular el cobro

Escenario 8: Sin datos sensibles
  Entonces el número completo y el CVV no aparecen en BD, logs, auditoría ni respuestas

Escenario 9: Validación de campos
  Dada una fecha vencida o un CVV que no tiene 3 dígitos → 400 VALIDATION_ERROR

Escenario 10: Pantalla
  Dado el flujo de confirmar, cambiar plan o renovar
  Entonces muestra el formulario con las tarjetas de prueba visibles y el aviso de simulación
  Y un rechazo muestra /suscripcion/fallida o un mensaje equivalente
```

## 5. Contrato de API

`POST /subscriptions/activate` y `POST /subscriptions/renew` aceptan:

```json
{ "planId": "uuid", "payment": { "cardNumber": "4242424242424242", "holderName": "Ana", "expiry": "12/30", "cvv": "123" } }
```

`renew` no lleva `planId`. Respuesta sin cambios. Errores nuevos: `402 PAYMENT_DECLINED`, `422 TEST_CARD_REQUIRED`. `GET /billing/operations` añade `cardLast4: string | null`.

## 6. Datos y Esquema

```sql
-- migrate:up
ALTER TABLE billing.billing_operation ADD COLUMN card_last4 char(4);
-- migrate:down
ALTER TABLE billing.billing_operation DROP COLUMN card_last4;
```

## 7. Interfaz de Usuario

- `components/payment-form.tsx`, reutilizado en las tres llamadas actuales de `billing-screens.tsx` (líneas ~84, ~187 y ~249).
- Quitar los textos "No se solicitan datos de tarjeta". Mostrar: "Simulación: usa solo estas tarjetas de prueba".
- El formulario no se guarda en el navegador; `autocomplete="off"`.

## 8. Diseño Técnico

```typescript
// billing/simulated-payment.ts — función pura
export type PaymentResult = { status: 'approved'; last4: string } | { status: 'declined' } | { status: 'not_test_card' };
export function simulatePayment(input: PaymentInput, now: Date): PaymentResult;
```

- **Orden en `activate`:** dentro de la transacción de `SubscriptionCoordinator`: bloqueo → idempotencia → cuota → **simular pago** → `persistSubscription(..., { cardLast4 })`.
- `recordOperation` recibe `cardLast4`.
- **`renew`:** verificar plan renovable antes de simular.
- **DTO:** `cardNumber` se normaliza quitando espacios; `@ValidateNested`. El filtro de errores no debe devolver el valor recibido.
- **Riesgo:** registrar el cuerpo de la solicitud. Prueba del escenario 8.
- `seed-demo` y el alta usan el plan Demo y no pasan por el controlador.

## 9. Plan de Tareas

- [ ] **T1 (30 min)**: `simulatePayment`, DTO y migración.
- [ ] **T2 (40 min)**: Coordinador, `renew` y `recordOperation`.
- [ ] **T3 (45 min)**: `payment-form` y los tres flujos.
- [ ] **T4 (35 min)**: Pruebas.

**Archivos permitidos:** la migración, `billing/simulated-payment.ts` y su spec (nuevos), `billing/billing.dto.ts`, `billing/billing.service.ts`, `billing/entities/billing-operation.entity.ts`, `integration/subscription.coordinator.ts`, `integration/subscriptions.controller.ts`, sus `*.spec.ts`, `audit/audit.types.ts`, `components/payment-form.tsx` (nuevo), `components/billing-screens.tsx`, `lib/api/billing.ts`, `lib/api/types.ts`, `app/globals.css`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–3, 9 | Unitaria | `simulated-payment.spec.ts` |
| Escenarios 2, 4–8 | Unitaria | `subscription.coordinator.spec.ts`, `subscriptions.controller.spec.ts` |
| Escenario 10 | Manual | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6, `BUSINESS_RULES.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
