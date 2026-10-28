# SPEC-103: RECUPERACIÓN DE CONTRASEÑA Y OUTBOX DE CORREO GENERALIZADO

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (Zona Protegida - Credenciales, sesiones y esquema) |
| **Responsable Principal** | Sebastián (Dominio IAM) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/iam/`; migración en `database/migrations/` (la consolida Víctor) |
| **Requisitos Vinculados** | Curso §4.1 (recuperación de contraseña), RNF-004 (Argon2id) |
| **Dependencias** | Migración del outbox (✅ creada y verificada: `database/migrations/20261027090000_allow_password_reset_outbox_kinds.sql`) y T2 (Víctor). **Bloquea a** 102 (reutiliza el outbox y el flujo de definir contraseña) y 105. Absorbe a SPEC-107. |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) |
| **Estimación** | 2.3 h Sebastián (T3–T5) + 0.7 h Víctor (T2) |
| **Estado** | En revisión (reescrita 2026-10-27 según ADR-007) |

---

## 2. Objetivo

Permitir que una persona que olvidó su contraseña la restablezca con un enlace de un solo uso enviado por correo, y que el restablecimiento cierre todas sus sesiones. De paso, generalizar el outbox de correo (hoy solo `email_verification`) para que 102 pueda enviar invitaciones.

---

## 3. Fuera de Alcance (YAGNI)

- SMS, WhatsApp o preguntas de seguridad.
- Limitación de intentos (`429`) en `forgot-password`: no en este corte; se mitiga invalidando los tokens previos al emitir uno nuevo.
- Reenvío manual del correo y re-emisión de token en el reintento del outbox para `password_reset`/`member_invitation` (si el token vence, el mensaje se abandona y se vuelve a solicitar).
- Cambio de contraseña estando autenticado (pantalla de perfil): no en este corte.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Solicitud para un correo registrado
  Dado un usuario activo con email "usuario@nexus.com"
  Cuando envía POST /api/auth/forgot-password con ese correo
  Entonces responde 200 con el mensaje genérico
  Y se crea un token (purpose password_reset, 15 min, solo hash) y un mensaje kind "password_reset" en el outbox
  Y los tokens password_reset previos sin usar de ese usuario quedan inválidos

Escenario 2: Correo no registrado
  Dado "noexiste@nexus.com" sin cuenta
  Cuando solicita el restablecimiento
  Entonces responde 200 con el MISMO mensaje y no se crea token ni mensaje

Escenario 3: Restablecimiento válido
  Dado un token vigente y sin usar
  Cuando envía POST /api/auth/reset-password con { token, newPassword } que cumple la política
  Entonces responde 200
  Y el password_hash se reemplaza por un hash Argon2id
  Y el token queda usado (used_at)
  Y TODAS las sesiones del usuario quedan revocadas
  Y email_verified queda en true

Escenario 4: Token inválido
  Dado un token vencido, ya usado o inexistente
  Cuando intenta restablecer
  Entonces responde 400 INVALID_OR_EXPIRED_TOKEN y no cambia nada

Escenario 5: Contraseña débil
  Dado un token vigente y una newPassword que no cumple la política de RegisterDto
  Entonces responde 400 VALIDATION_ERROR y el token NO se consume

Escenario 6: Mensaje de invitación (compartido con SPEC-102)
  Dado un mensaje del outbox con kind "member_invitation"
  Cuando el worker lo procesa
  Entonces envía el correo de invitación con un enlace a /nueva-contrasena?token=... y NO emite un token nuevo si venció
```

---

## 5. Contrato de API

Ver `CONTRACTS.md` v0.5, "Recuperación de contraseña".

- `POST /api/auth/forgot-password` (pública): `{ email }` → `200 { message }` genérico.
- `POST /api/auth/reset-password` (pública): `{ token, newPassword }` → `200 { message }` | `400 INVALID_OR_EXPIRED_TOKEN` | `400 VALIDATION_ERROR`.

---

## 6. Datos y Esquema

- **¿Modifica BD?** Sí, **una migración** (la consolida Víctor, `database/migrations/20261027090000_allow_password_reset_outbox_kinds.sql`). `iam.email_outbox` tiene `CHECK (kind IN ('email_verification'))`; hay que ampliarlo:

```sql
-- migrate:up
ALTER TABLE iam.email_outbox DROP CONSTRAINT ck_email_outbox_kind;
ALTER TABLE iam.email_outbox ADD CONSTRAINT ck_email_outbox_kind
  CHECK (kind IN ('email_verification', 'password_reset', 'member_invitation'));

-- migrate:down
DELETE FROM iam.email_outbox WHERE kind <> 'email_verification';
ALTER TABLE iam.email_outbox DROP CONSTRAINT ck_email_outbox_kind;
ALTER TABLE iam.email_outbox ADD CONSTRAINT ck_email_outbox_kind CHECK (kind IN ('email_verification'));
```

- `iam.one_time_token` ya tiene `purpose = 'password_reset'` (enum `TokenPurpose.PASSWORD_RESET`). Sin cambios.

---

## 7. Interfaz de Usuario (UI/UX)

Pantallas en SPEC-105.

---

## 8. Diseño Técnico

- **Servicio nuevo** `services/password-reset.service.ts` (SRP; no engordar `AuthService`):
  - `requestReset(email: string): Promise<void>` — normaliza el correo; si el usuario existe y está `active`: en una transacción invalida tokens previos, crea token (15 min) y el mensaje del outbox; tras el commit llama a `dispatch(id)` **sin esperarlo** (evita diferencias de tiempo observables).
  - `reset(token: string, newPassword: string): Promise<void>` — en una transacción: valida el token (hash, `purpose`, no vencido, no usado), hashea con Argon2id, actualiza usuario (`passwordHash`, `emailVerified = true`), marca el token usado y llama `SessionRepository.revokeAllForUser(tx, userId)`.
- **Outbox generalizado** (`email-outbox.service.ts`): `enqueue(tx, { kind, ... })`; `send()` despacha por `kind`; la renovación de token (`freshPayload`) **solo** para `email_verification`. Para los otros dos, `expires_at` del mensaje = vencimiento del token y, vencido, se marca `expired`.
- **Puerto de correo** (`ports/verification-mailer.ts`): añadir `sendPasswordReset(to, name, rawToken)` y `sendMemberInvitation(to, name, rawToken)`; `EmailService` implementa ambos. Texto genérico, sin nombres de organización.
- **Constantes** (`constants.ts`): `PASSWORD_RESET_TOKEN_TTL_MINUTES = 15`, `MEMBER_INVITATION_TOKEN_TTL_HOURS = 24`, ruta `/nueva-contrasena` (enlace = `WEB_URL` + ruta + `?token=`).
- **Transaccionalidad:** crear token + mensaje en una `UnitOfWork`; el envío SMTP ocurre después del commit (igual que el registro).
- **Auditoría:** `AUTH_PASSWORD_RESET` se añade en SPEC-405.
- **Riesgos y mitigaciones:** enumeración de correos (respuesta idéntica y despacho no esperado); reutilización de token (`used_at` en la misma transacción que el cambio); sesiones robadas siguen vivas (se revocan todas); registrar el token en logs (prohibido: el outbox lo guarda cifrado y los logs nunca lo imprimen).

---

## 9. Plan de Tareas

- [x] **T1**: migración del outbox, creada y verificada contra Postgres 16 (up, down y re-up). Falta aplicarla en cada entorno local (`npm run migration:run`).
- [ ] **T2 (Víctor, 40 min; asignado a Víctor para quitar carga a la ruta crítica de IAM)**: generalizar `EmailOutboxService` + `VerificationMailer`/`EmailService` + constantes (`password_reset`, `member_invitation`). **Abrir este PR primero: SPEC-102 depende de él.**
- [ ] **T3 (35 min)**: `PasswordResetService` + `SessionRepository.revokeAllForUser`.
- [ ] **T4 (15 min)**: rutas y DTOs (`ForgotPasswordDto`, `ResetPasswordDto` con la política de `RegisterDto`) en `IamController`.
- [ ] **T5 (50 min)**: pruebas (escenarios 1–6; revocación de sesiones; invalidación de tokens previos; no consumir token con contraseña débil).

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–5 | Unitaria | `modules/iam/iam.password-reset.spec.ts` |
| Escenario 6 | Unitaria | `modules/iam/iam.outbox.spec.ts` (ampliar) |
| Revocación de sesiones | Unitaria | `modules/iam/iam.password-reset.spec.ts` |

---

## 11. Impacto en Documentación

- [x] `CONTRACTS.md` v0.5.
- [ ] `docs/modules/IAM.md`: documentar los tres `kind`.
- [ ] `ENTS_REGISTRY.md`: sin entidad nueva.

---

## 12. Preguntas Abiertas

Ninguna. Decisiones: ADR-007 §5 y §6.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-27 | Revisión | Declarada la migración del outbox (el CHECK lo impedía); generalización del outbox; revocación de todas las sesiones (ADR-003, absorbe SPEC-107); `email_verified = true`; respuesta idéntica y despacho no esperado. |
