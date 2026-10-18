## 2026-10-18 — IAM: registro, verificación de correo, login, sesión y `/auth/me` (PR #6)

- **Estado:** en revisión. **No listo para integrar** hasta resolver las decisiones de abajo.
- **Alcance:** módulo IAM del monolito alineado al diagrama de clases y al esquema real (`iam.user`, `iam.role`, `iam.membership`, `iam.session`, `iam.one_time_token`, `admin.organization`). Sin migraciones nuevas. Registro transaccional (usuario, organización `cloud`, membresía `tenant_admin`), login con Argon2id y JWT de 15 min, refresh en cookie `HttpOnly` con rotación, `GET /auth/me`, error común `{ code, message, requestId }`.
- **Pendientes de decisión (bloquean la integración):**
  1. **Contrato:** aprobar `POST /auth/verify-email`, `/auth/refresh` y `/auth/logout` (propuesta lista en `docs/proposals/CONTRACTS.iam-propuesta.diff`). Responsable: Víctor.
  2. **Hooks de registro:** la regla aprobada exige que usuario, organización, membresía, suscripción demo y cuota sean atómicos, y el contrato que el registro cree "Mi espacio" y "Archivos". Billing (Anthony) y Files (Miguel) deben participar en la transacción; mecanismo propuesto `RegistrationHooks`, sin aprobar.
  3. **Organización activa al renovar la sesión:** `iam.session` no guarda `organization_id`; el refresh la vuelve a derivar. Responsables: integrador (esquema) y Víctor (selector).
  4. **Reenvío de verificación:** el enlace vence a los 15 minutos y hoy no hay forma de pedir otro.
  5. **Configuración compartida:** `synchronize` → `DB_SYNCHRONIZE`, filtro global de errores, compose con `mailpit` y `migrate`, y versión de `argon2`. Responsable: integrador.
  6. **Ruta web de verificación:** el correo enlaza a `/verificar-correo` (registrada el 2026-09-29); falta confirmar con Víctor que la página lee `token`.
- **Pruebas:** 41 pruebas unitarias sin base de datos (ejecutadas con un ejecutor mínimo, no con Jest) y script de humo 41/41 ejecutado por el autor contra PostgreSQL y Mailpit. **Pendiente de pegar:** resultado de Jest real y del e2e.
- **Pendiente del siguiente corte:** recuperar contraseña (al cambiarla se deben revocar todas las sesiones), RBAC completo y rol Auditor, límite de intentos (`429`), selector de organización.
