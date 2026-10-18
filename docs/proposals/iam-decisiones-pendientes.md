# IAM — decisiones pendientes (PR #6)

Estado: **sin aprobar**. Cada punto describe el bloqueo, quién decide y qué NO se hizo mientras tanto.
Revisión del 2026-10-18 con `BUSINESS_RULES.md`, `CONTRACTS.md`, `CONTRIBUTING.md`, `SESSION_LOG.md` y `ARCHITECTURE.md`. Sigue sin verse el repositorio, la PR, `ENTS_REGISTRY.md`, los ADR-002/003/004, `docs/modelo-minimo.md` ni `apps/web` (ver `revision_pr6_iam_resultado.md`).

| # | Decisión que falta | Quién decide | Evidencia y por qué bloquea | Qué NO se hizo |
|---|---|---|---|---|
| D1 | Aprobar `POST /auth/verify-email`, `/auth/refresh` y `/auth/logout` en `CONTRACTS.md` | Víctor (consumidor) + integrador | El comportamiento está aprobado (`CONTRACTS.md:42-43`) pero las rutas no figuran y el contrato exige documentarlas antes de implementarlas (`:51`); `CONTRIBUTING.md:8` las trata como bloqueadas. Son requisitos del producto final (`BUSINESS_RULES.md:68`), no del recorrido del 30% | No se editó `CONTRACTS.md`. Propuesta lista: `CONTRACTS.iam-propuesta.diff` (aplica limpio sobre el archivo real) |
| D2 | Cómo conservar la **organización activa** al renovar la sesión | Integrador (esquema) + Víctor (selector) | `iam.session` no tiene `organization_id` y `refresh()` vuelve a derivar la primera membresía activa. Varias organizaciones por cuenta y sesiones en varios dispositivos están aprobadas (`BUSINESS_RULES.md:86,92`); el selector no está en el 30%. Añadir la columna es un cambio de esquema compartido (`CONTRIBUTING.md:36`) | No se cambió el modelo de sesión. 2 `it.todo` en `iam.security.spec.ts` |
| D3 | Mecanismo y propiedad de los hooks de registro de Billing (suscripción demo + cuota) y Files (Drive "Mi espacio" + carpeta "Archivos") | Anthony, Miguel + integrador | Regla aprobada: creación atómica de usuario, organización, membresía, suscripción demo y cuota (`BUSINESS_RULES.md:95`); y el registro crea el Drive y la carpeta (`CONTRACTS.md:45`). Hoy el registro solo crea las tres primeras (`SESSION_LOG.md:15`). `RegistrationHooks` es propuesta de IAM, sin aprobación visible | No se tocó Billing/Files. Del lado IAM se prueba que los hooks reciben la transacción y que su fallo revierte el registro |
| D4 | Flujo de **reenvío de verificación** (p. ej. `POST /auth/resend-verification`, respuesta uniforme, límite de intentos) | Víctor + integrador | Ningún documento lo define. El token vence a los 15 min (`CONTRACTS.md:42`) y solo el registro lo emite: con SMTP caído o enlace vencido la cuenta no puede verificarse mientras el login lo exija | No se implementó ningún endpoint nuevo |
| D5 | Confirmar que la página web `/verificar-correo` lee `?token=` y llama a `POST /auth/verify-email` | Víctor | **Parcialmente resuelto:** `SESSION_LOG.md:54` registra la ruta `/verificar-correo`; el correo ahora enlaza ahí (configurable con `IAM_VERIFY_EMAIL_PATH`). Falta confirmar el parámetro y el comportamiento: `apps/web` no está disponible | Cambio de código ya hecho (solo la ruta del enlace). No se tocó la web |
| D6 | Configuración global compartida: `synchronize` → `DB_SYNCHRONIZE` (apagado por defecto), `ApiExceptionFilter` global, compose unificado, `logging` de TypeORM y versión de `argon2` | Integrador + responsables de Billing/Files | `CONTRIBUTING.md:31-32` exige coordinar `docker-compose.yml`, `package.json` y configuración común; `:40`, justificar dependencias. `ARCHITECTURE.md:91-94` lista 3 servicios y el compose unificado añade `mailpit` y `migrate`. Con `logging` activo TypeORM imprime parámetros, incluidos `password_hash` y hashes de token | No se modificaron `app.module.ts`, `main.ts`, compose ni `package.json`. Tras aprobar, actualizar `ARCHITECTURE.md` |
| D7 | Ruta canónica de migraciones (`database/migrations` vs. `apps/db/database/migrations`) y cómo se cargan los roles `tenant_admin` y `colaborador` en un entorno nuevo | Integrador | El registro necesita esas filas de `iam.role`; si salen de un seed y no de una migración, un entorno nuevo puede quedar sin ellas | No se movió ni creó ninguna migración. IAM no añade migraciones |

## Pendientes derivados de las reglas (no son decisiones, son trabajo futuro de IAM)
- **Cambiar o recuperar la contraseña debe revocar todas las sesiones activas** (`BUSINESS_RULES.md:92`). `SessionRepository.revokeAllActiveOf` ya existe; `one_time_token` ya admite el propósito `password_reset`.
- **Rol Auditor:** su modelado en `ROLE` debe acordarse antes de implementarlo (`BUSINESS_RULES.md:29`); no se inventó.
- **Límite de intentos (`429`)** en register, login y refresh, y **bitácora de auditoría** de logins (`BUSINESS_RULES.md:63`, fase posterior).
- **Selector de organización activa** (ligado a D2) y RBAC completo.

## Cumplimiento verificado contra `BUSINESS_RULES.md`
Correo normalizado y único (`:14`); Argon2id (`:15`); registro transaccional de usuario, organización y membresía (`:16`); par único usuario-organización (`:17`); el `organizationId` del cliente se rechaza con 400 (`:18`); membresía u organización suspendida/cancelada se valida en cada request (`:19`); `is_super_admin` no concede autorización (`:20`); roles `tenant_admin`/`colaborador` y administrador mínimo para quien registra (`:29-31`); MFA fuera de alcance, con falla cerrada si `mfa_enabled` (`:93`).

## Comprobaciones a ejecutar en el repositorio (no son decisiones)
```bash
# Hallazgo 4 — ¿queda el modelo de token antiguo?
git ls-files | grep -iE "email-verification-token|one-time-token"
grep -rn "EmailVerificationToken" apps/api/src || echo "sin referencias"

# Hallazgo 5 / D7 — migraciones
git ls-files | grep -i migrations
git diff --stat main...HEAD -- database apps/db
grep -rn "tenant_admin" database apps/db 2>/dev/null | head

# Hallazgo 11 — artefactos accidentales
git ls-files | grep -iE "\.Rhistory|cookies\.txt|docker-compose\.old|iam-migration-proposal\.sql|(^|/)\.env$"
git log --oneline -- .Rhistory | head -3
grep -inE "Rhistory|cookies|\.env" .gitignore

# D5 — página web de verificación
find apps/web -iname "*verific*" -not -path "*/node_modules/*"
grep -rn "token\|verify-email" apps/web/src/app/verificar-correo 2>/dev/null | head
```
`cookies.txt` (creado por `curl -c cookies.txt` en las pruebas manuales) contiene un refresh token vivo: si aparece versionado, retirarlo del historial y revocar esa sesión (`CONTRIBUTING.md:46`).
