# SPEC-306: COMPROBANTES DESCARGABLES

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/billing/`, `apps/web/src/app/suscripcion/` |
| **Requisitos Vinculados** | RF-013, Curso §4.2 |
| **Dependencias** | SPEC-305 |
| **Prioridad** | P2 |
| **Estimación** | 1.5 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Cada operación del historial tiene un comprobante para imprimir o guardar como PDF, marcado como simulado.

## 3. Fuera de Alcance

- Facturas fiscales o envío por correo.
- Generar PDF en el servidor: requeriría una librería; se usa la impresión del navegador.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Consultar
  Cuando un tenant_admin envía GET /billing/operations/:id/receipt
  Entonces recibe organización, plan, tipo, monto, fecha, card_last4 y número de comprobante

Escenario 2: Pantalla
  Cuando abre /suscripcion/comprobante/:id
  Entonces ve el comprobante con la leyenda "Simulación: sin valor fiscal" y un botón "Imprimir o guardar PDF"

Escenario 3: Impresión
  Entonces al imprimir se oculta la navegación

Escenario 4: Permisos y aislamiento
  Dado un colaborador → 403 FORBIDDEN_ROLE
  Dada una operación ajena → 404

Escenario 5: Sin tarjeta
  Dada una operación sin card_last4 (por ejemplo, Demo) → no muestra esa línea
```

## 5. Contrato de API

`GET /billing/operations/:id/receipt` → `{ receiptNumber, organizationName, planName, type, amount, currency: "USD", cardLast4, occurredAt, simulated: true }`. `receiptNumber` se deriva de `operation_id`.

## 6. Datos y Esquema

Sin migración.

## 7. Interfaz de Usuario

Ruta nueva, reglas `@media print`, y un enlace "Comprobante" en cada fila del historial.

## 8. Diseño Técnico

`BillingService.getReceipt(organizationId, operationId)`, filtrando por la suscripción de la organización. El nombre de la organización sale de `AuthUser.organizationName`.

## 9. Plan de Tareas

- [ ] **T1 (30 min)**: Servicio y ruta.
- [ ] **T2 (40 min)**: Pantalla e impresión.
- [ ] **T3 (20 min)**: Pruebas.

**Archivos permitidos:** `billing/billing.service.ts`, `billing/billing.controller.ts`, `billing/billing.dto.ts`, sus specs, `app/suscripcion/comprobante/[id]/page.tsx` (nuevo), `components/billing-screens.tsx`, `lib/api/billing.ts`, `lib/api/types.ts`, `app/globals.css`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1, 4 | Unitaria | `billing.service.spec.ts`, `billing.controller.spec.ts` |
| Escenarios 2, 3, 5 | Manual | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
