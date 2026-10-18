# Devolución para Anthony — PR #4 Billing

**Fecha:** 2026-10-17
**Devolución dirigida a:** Anthony (responsable de Billing, según el plan del módulo)
**Usuario autor en GitHub:** `KD-Rafa3l`
**Área:** Billing
**PR:** [PR #4](https://github.com/Victor-Chan-Morales/Nexus_Sistema_Almacenamiento_Seguro/pull/4)
**Instrucción vigente:** implementar las correcciones de esta devolución contra `CONTRACTS.md` v0.3, aprobado por Víctor como integrador el 2026-10-18. No hace falta esperar otra aprobación de contrato. El PR #4 aún debe actualizar sus números de catálogo, vigencia, cuota y persistencia.

Se revisó el diff de la PR y se contrastó con los contratos, planes y decisiones vigentes del repositorio. No se ejecutaron pruebas; los pasos o capturas incluidos por el autor no se consideran verificación independiente del estado actual de la rama.

---

### Correcciones necesarias

1. **Mantener Demo gratuito sin vencimiento y corregir las unidades.** En `billing.service.ts`, el seed fija `validityDays: 30` para Demo, la activación siempre genera `expiresAt` y los límites del PR usan bytes binarios. Implementar los valores decimales exactos de `CONTRACTS.md` v0.3: Demo `5000000000` bytes y `validityDays: null`; Team `100000000000`; Business `500000000000`; Enterprise `2000000000000`. Demo devuelve `endDate: null`; los planes pagados simulados vencen a los 30 días. No conviertas `null` en 30 con un valor por defecto.

2. **Provisionar la suscripción Demo durante el registro.** El plan de Billing requiere una suscripción Demo desde el alta; el registro y suscripción/cuota deben ser atómicos. `seedDefaultPlans()` solo crea filas del catálogo: no asigna una suscripción a una organización. Conectar la provisión al hook transaccional de IAM usando el mismo `EntityManager` recibido, tal como exige `CONTRACTS.md` v0.3. Evitar que Files aplique silenciosamente una cuota de 5 GB cuando no existe una suscripción persistida.

3. **Dar persistencia transaccional al coordinador de integración.** `subscribe()` cancela la suscripción previa y luego crea otra en operaciones separadas. Víctor coordina `POST /subscriptions/activate` desde `SubscriptionCoordinator`, consulta a Files por uso y reservas, y delega en Billing la escritura transaccional. Implementa en Billing la operación transaccional que el coordinador necesita; Billing no debe importar ni consultar tablas de Files. Al reactivar el mismo plan, devuelve la suscripción vigente sin crear otra. Un plan menor solo se acepta si `uso confirmado + reservas activas` cabe en el nuevo límite.

4. **Alinear estado persistido, vigencia y límites.** El modelo guarda `SubscriptionStatus.SIMULATED`, mientras la API responde `status: "active"`. `simulated: true` indica que no hubo cobro; el ciclo de vida es `active`, `expired` o `cancelled`. `getSubscription(organizationId)` devuelve solo una suscripción vigente o `null`; una Demo sin vencimiento permanece activa. `getStorageLimitBytes()` devuelve `0` si no hay suscripción vigente, nunca 5 GB por defecto.

5. **No ocultar fallas del catálogo.** `seedDefaultPlans()` captura cualquier error sin registrarlo y solo actúa cuando el conteo total es cero. Una base parcialmente sembrada queda incompleta sin señal. Hacer el seed repetible por clave estable (por ejemplo, nombre/ID aprobado), registrar el error con contexto seguro y fallar el arranque o el estado de salud si el catálogo requerido no está disponible. Preferir el mecanismo de seed/migración acordado para desarrollo.

6. **Completar validación del DTO.** `billing.dto.ts` declara `ActivateSubscriptionDto`, pero el controlador no lo usa ni valida `planId`; usa un objeto inline. Aplicar DTO con `class-validator` (UUID y presencia), `ValidationPipe` y errores del formato común. Mantener tenant exclusivamente desde `req.user.organizationId`.

7. **Versionar cambios de entidad.** `description` y `validityDays` alteran el esquema de `Plan`. Entregar al integrador los cambios de esquema para consolidarlos en `database/migrations/` en la raíz, siguiendo `CONTRIBUTING.md`; la ubicación y el flujo ya están aprobados. No depender de `synchronize` como mecanismo de despliegue. Definir qué ocurre con registros ya existentes y con el catálogo parcialmente cargado.

8. **Limpiar artefactos del PR.** Quitar `apps/api/tsconfig.build.tsbuildinfo` y cambios ajenos de `apps/web/next-env.d.ts` si no son necesarios. No incluir artefactos de compilación en la entrega funcional.

### Contrato aprobado que debe implementar (v0.3)

- `GET /api/plans` es público y entrega `{ items: [...] }` con `validityDays: number | null`; `priceMonthly` está en USD y `storageLimitBytes` en bytes decimales.
- Catálogo: Demo US$0/`5000000000` bytes/5 usuarios/`validityDays: null`; Team US$19.99/`100000000000`/10/30 días; Business US$59.99/`500000000000`/30/30 días; Enterprise US$149.99/`2000000000000`/100/30 días.
- La respuesta de activación usa `status: "active"`, `simulated: true`, `startDate` ISO y `endDate: null` para Demo. No acepta datos de tarjeta.
- Una organización tiene como máximo una suscripción vigente; activar de nuevo el mismo plan es idempotente; reemplazar plan es transaccional. Un downgrade considera uso confirmado y reservas de Files.
- Sin suscripción vigente, el límite es `0` bytes. Billing no consulta las tablas de Files; el `SubscriptionCoordinator` de Víctor consulta el puerto de uso/reservas y delega la persistencia a Billing.
- `GET /dashboard` agrega información con llamadas in-process; Billing no consulta SeaweedFS.

### Falta implementar o entregar

- Provisión atómica de suscripción Demo en registro y su asociación a cuota.
- Validación del plan menor contra el uso que Files confirma en bytes.
- Manejo de activación repetida, vencimiento y estado actual.
- Pruebas reproducibles de catálogo vacío, catálogo sembrado parcialmente, activación sin sesión, activación repetida, downgrade rechazado y consumo de cuota.
- Actualizar README de Billing y `SESSION_LOG.md` con resultados reales, no solo con pasos propuestos.

**Referencias:** `Planes de trabajo individuales/PLAN_ANTHONY_BILLING.md`, `docs/PROPUESTA_PLANES_PRECIOS.md`, `CONTRACTS.md`, `BUSINESS_RULES.md`, ADR-002 y ADR-003.

---
## Criterios para solicitar nueva revisión

- [ ] Demo queda sin vencimiento; los planes pagados conservan la vigencia aprobada.
- [ ] El alta de organización provisiona Demo y cuota dentro del flujo atómico con IAM.
- [ ] Activación/cambio de plan es transaccional, respeta la cuota actual y tiene comportamiento definido al repetirse.
- [ ] Catálogo, DTO, migración y respuestas coinciden con el contrato aprobado.
- [ ] Seed falla de forma visible y repetible si el catálogo queda incompleto; se quitaron artefactos generados.
- [ ] Se adjuntan resultados de prueba de catálogo, activación, vencimiento, downgrade y cuota.
