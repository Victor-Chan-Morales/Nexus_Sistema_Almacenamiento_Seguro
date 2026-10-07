# Plan individual de Anthony para Billing y cuotas

**Responsabilidad:** catálogo persistido, activación de suscripción de demostración y límite de plan consumido por Files y Dashboard.

## Resultado esperado

La web consulta el catálogo real, muestra la suscripción demo provisionada durante el registro y permite un cambio simulado de plan para la organización autenticada. Files aplica el límite desde el backend y el Dashboard muestra el límite y uso reales. No hay cobro ni datos de tarjeta.

## Pasos de trabajo

### 1. Confirmar catálogo y contrato

- Leer `PLAN_INTEGRACION_50_PORCIENTO.md`, `CONTRACTS.md`, `BUSINESS_RULES.md`, `ENTS_REGISTRY.md`, `ARCHITECTURE.md` y ADR-003.
- Confirmar datos del plan demo: 5 GB, 5 usuarios, vigencia y precio de demostración según fuente aprobada; no copiar precios propuestos como valores aprobados.
- Confirmar rutas: `GET /plans`, `POST /subscriptions/activate` y, si el frontend la necesita, `GET /billing/subscription` documentada como consulta de la organización autenticada.
- Mantener respuesta con `simulated: true`; no aceptar datos financieros.

**Entrega verificable:** catálogo, campos, valores y estados confirmados con Víctor y Miguel.

### 2. Asegurar datos y activación

- Asegurar carga repetible de planes de desarrollo; la pantalla no inventa nombres, cuota ni precio.
- Coordinar con Sebastián para asignar la suscripción demo y cuota dentro del registro atómico según ADR-002; mantener un único plan activo por organización.
- En `POST /subscriptions/activate`, cambiar la suscripción vigente para `req.user.organizationId`, nunca para un ID enviado por el navegador; el plan demo ya se provisiona durante registro.
- Definir y documentar comportamiento para repetición de activación y cambio de plan: como máximo una suscripción activa; una reducción solo si uso confirmado cabe en el límite nuevo.
- Alinear el estado almacenado y el estado de respuesta. No responder `active` si el registro persiste solo `simulated` como estado, salvo que el modelo distinga explícitamente estado de suscripción e indicador de simulación.
- Rechazar plan inexistente y organización no autenticada con errores compatibles con contrato.

**Entrega verificable:** activación persiste organización/plan/estado/fechas e indica claramente que fue simulada.

### 3. Exponer límite para uso interno

- Exportar `BillingService` desde BillingModule.
- Exponer un resumen del plan/suscripción vigente desde `BillingService` para que `DashboardModule` no consulte repositorios de Billing directamente.
- Mantener `getStorageLimitBytes(organizationId)` como consulta interna consumida directamente por Files; no crear una llamada HTTP entre módulos.
- Definir comportamiento cuando una organización no tenga suscripción: la provisión del registro debe evitar ese estado; si se encuentra una, responder un estado explícito y no aplicar silenciosamente un límite inventado.
- Confirmar con Miguel qué archivos cuentan para uso. Files es responsable del tamaño usado real; Billing es responsable del límite.

**Entrega verificable:** una carga de Files recibe el límite correcto en bytes del plan de la organización.

### 4. Dar datos al Dashboard y conectar UI

- Acordar con Víctor el tipo del Dashboard. Billing aporta el plan/suscripción; Files aporta el uso; la agregación ocurre dentro de la API en el endpoint `GET /dashboard`.
- No implementar `/billing/usage` salvo que el equipo actualice primero `CONTRACTS.md` y sus consumidores. La fuente del Dashboard sigue siendo una respuesta agregada.
- Entregar a Víctor los estados UI para carga, catálogo vacío, activación exitosa, conflicto y plan inválido.
- Conectar o revisar la integración web de catálogo/activación usando `apps/web/src/lib/api/billing.ts`; no construir una segunda pantalla paralela.

**Entrega verificable:** Dashboard muestra el demo provisionado; al cambiar de plan, refleja el nuevo plan y límite después de consultar API.

### 5. Revisar y documentar

- Documentar escenarios de catálogo vacío, plan inexistente, sin sesión, organización aislada, activación repetida, cambio a plan menor y límite en bytes.
- Abrir PR limitado a Billing/seed/documentación y atender revisión.

## Archivos principales

- `apps/api/src/modules/billing/billing.controller.ts`
- `apps/api/src/modules/billing/billing.service.ts`
- `apps/api/src/modules/billing/billing.module.ts`
- `apps/api/src/modules/billing/entities/`
- Seed/configuración de planes de desarrollo
- `apps/web/src/lib/api/billing.ts` y tipos solo con coordinación
- `CONTRACTS.md`, `SESSION_LOG.md`

## Dependencias

- Sebastián provee `organizationId` autenticado.
- Miguel consume el servicio de Billing en el mismo proceso y calcula uso confirmado.
- Víctor integra catálogo, cambio/activación y Dashboard.

## Cierre de Anthony

- [ ] Plan demo se obtiene de catálogo persistido.
- [ ] Suscripción se atribuye al tenant autenticado y se marca como simulada.
- [ ] Repetición/cambio de plan tiene resultado definido y respeta uso confirmado.
- [ ] Files recibe límite en bytes mediante inyección de BillingService.
- [ ] No hay pagos reales, tarjetas ni cuota proveniente del cliente.
