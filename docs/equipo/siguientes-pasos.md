# SIGUIENTES PASOS — GUÍA RÁPIDA (CORTE DEL 80%, VIERNES 30)

> **Para compartir por WhatsApp.** Actualizado el 2026-10-27 con **7 h por persona**.
> **Antes de empezar:** lean `docs/decisions/ADR-007-decisiones-corte-80.md` y la parte de su spec en `CONTRACTS.md` v0.5. Las specs están **En revisión**: no codifiquen una hasta que Víctor la apruebe (hoy, miércoles por la mañana).
> **Corte de recorte: jueves 12:00.** Lo que no esté iniciado a esa hora pasa al 100%.
> **Si te bloqueas más de 30 minutos:** `🚨 BLOQUEO [SPEC-XXX]: intenté X, esperaba Y, obtuve Z (archivo)`.
> **La migración del outbox ya existe.** Cada quien la aplica en su entorno: `npm run migration:run`.

---

## Sebastián — IAM (≈ 7.8 h)

1. **SPEC-101** — `@Roles` + `RolesGuard` (2 h). El rol real es `colaborador`. **PR primero: bloquea a 102, 104, 302 y 402.**
2. **SPEC-103** — recuperación de contraseña, **tareas T3–T5** (2.3 h): servicio, rutas, pruebas. El outbox generalizado (T2) lo deja Víctor. Resetear revoca **todas** las sesiones.
3. **SPEC-102** — alta de miembros (2.5 h): `fullName`, `email`, `role`; correo de otra organización → 422; respeta el límite del plan.
4. **SPEC-104** — listado de miembros (1 h). **Es lo primero que se recorta si hay retraso.**

## Miguel — Files y apoyo en pantallas (≈ 6.5 h)

1. **SPEC-105** y **SPEC-106** (3 h): recuperación de contraseña y miembros en `/configuracion`. Trabaja contra datos simulados del contrato v0.5 hasta que existan las APIs.
2. **SPEC-402** — `GET /audit/events` (1.5 h), **solo después de que 401 esté mergeado**; solo `tenant_admin`.
3. **SPEC-303** — historial y "Renovar" en `/suscripcion` (1.5 h), después de 301.
4. **SPEC-405 (Files)** — tres eventos `FILE_*` (upload, download, delete) (0.5 h). Restore y purge llegan con 203 y 204.
5. **Si sobra tiempo (viernes), en este orden:** 202 y 203, 205, 204, 206, 207 (papelera y versiones).

## Anthony — Billing y Audit (≈ 6.6 h)

1. **SPEC-401** — `AuditModule` global (2.5 h). **PR primero.** Entidad en `audit.audit_event` (con esquema); `record_hash` y `prev_hash` desde el primer evento; bloqueo por organización.
2. **SPEC-301** — registrar y consultar operaciones (2 h). Ojo: **nada escribe `billing_operation` hoy** y el coordinador crea la suscripción por su cuenta.
3. **SPEC-302** — renovación `POST /subscriptions/renew` (1.5 h). Ya no es "cambio de plan": eso lo hace `activate`.
4. **SPEC-102 T6** (política `user-limit`, 20 min) y **SPEC-405 (Billing)** (`PLAN_ACTIVATED`, `PLAN_RENEWED`, 20 min).

## Víctor — Coordinación (≈ 8.2 h)

1. **Miércoles por la mañana:** aprobar `CONTRACTS.md` v0.5 y las specs; **103-T2** (outbox generalizado, 40 min) y mergearlo temprano.
2. **SPEC-403** — pantalla de auditoría (1.5 h), después de 402.
3. **SPEC-405 (IAM)** — `AUTH_LOGIN`, `AUTH_PASSWORD_RESET`, `MEMBER_ADDED` (0.5 h), después de 102 y 103.
4. **Continuo:** revisar y mergear PR; jueves 8:00 PM demo interna; **viernes:** recorrido de punta a punta (registro → verificación → login → subir → descargar → miembros → renovar plan → auditoría) y congelar.
5. **Sin horas asignadas:** documentos 701/702 (requisitos y UML).

---

## Qué NO se hace en este corte (se declara en la exposición)

Papelera (si no entra en P2), versiones, carpetas de equipo, enlaces compartidos, selección de modelo de despliegue, panel Super Admin real, rol Auditor, MFA/TOTP, rotación de llaves y cifrado en streaming, eventos de auditoría de intentos fallidos.
