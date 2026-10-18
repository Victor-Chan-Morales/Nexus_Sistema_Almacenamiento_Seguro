# Módulo IAM

Identidad, registro, verificación de correo, login, sesión y contexto de organización del monolito.
Código: `apps/api/src/modules/iam` · Prefijo global: `/api` · Responsable: Sebastián.
Contrato: `CONTRACTS.md` v0.2 (rutas marcadas *propuesta* esperan aprobación: `docs/proposals/iam-contracts-patch.md`).
Trazabilidad con el diagrama de clases y revisión SOLID: `docs/modules/IAM-diagrama-y-solid.md`.

## Estructura
```
iam/
├─ iam.controller.ts          HTTP ↔ casos de uso (único lugar con cookies)
├─ iam.module.ts              cablea puertos → implementaciones
├─ iam.settings.ts            política configurable (correo verificado, cookie)
├─ iam.errors.ts              errores { code, message } del contrato
├─ registration-hooks.ts      extensión del registro (Billing/Files)
├─ domain/                    enums con los valores EXACTOS de la BD (Role, UserStatus, ...), AuthResult
├─ entities/                  User, Organization, Membership, IamRole, Session, OneTimeToken (tablas existentes)
├─ ports/                     abstracciones: repositorios, UnitOfWork, PasswordHasher, AccessTokenIssuer, OpaqueTokens, VerificationMailer
├─ infrastructure/            TypeORM, Argon2id, JWT, crypto, SMTP (EmailService)
├─ services/                  AuthService, RegistrationService, SessionService, EmailVerificationService
├─ strategies/ guards/ decorators/ dto/
```
Dependencias: controlador → servicios → puertos ← infraestructura. IAM no usa Storage ni SeaweedFS.

## Qué exporta
| Export | Uso |
|---|---|
| `JwtAuthGuard` | `@UseGuards(JwtAuthGuard)` en endpoints protegidos |
| `@CurrentUser()` | `AuthUser { userId, organizationId, role, email, fullName, organizationName }`, validado en backend |
| `RegistrationHooks` | Billing/Files se enganchan a la transacción de registro |
| `AuthService`, `JwtModule`, `PassportModule` | Compatibilidad con el resto de módulos |

**Regla de tenant:** `organizationId` y `role` salen de JWT + membresía activa en organización activa, revalidadas en BD en cada
request. Ninguna ruta lee `organizationId` del body, query o headers; `ValidationPipe` con `forbidNonWhitelisted` rechaza campos no declarados.

**Roles** (catálogo `iam.role`): `tenant_admin` (quien registra la organización) y `colaborador`. En este corte solo se asigna `tenant_admin`. El diagrama los llama TENANT_ADMIN y COLABORADOR; el API usa los nombres de la BD.

## Error común (CONTRACTS.md)
`{ "code": "ERROR_CODE", "message": "Mensaje seguro", "requestId": "uuid" }`, producido por `ApiExceptionFilter` (`src/common/filters`).

| HTTP | code | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Datos ausentes, mal formados o campos no permitidos |
| 400 | `INVALID_VERIFICATION_TOKEN` | Token inválido, usado o vencido |
| 401 | `INVALID_CREDENTIALS` | Correo inexistente, contraseña incorrecta o cuenta `inactive`/`locked` (mismo mensaje y tiempo) |
| 401 | `INVALID_SESSION` | Refresh token ausente, vencido, revocado o reutilizado |
| 401 | `UNAUTHORIZED` | Sin token, token inválido/vencido o membresía ya no activa |
| 403 | `EMAIL_NOT_VERIFIED` | Contraseña correcta pero correo sin verificar |
| 403 | `NO_ACTIVE_MEMBERSHIP` | Sin organización activa |
| 403 | `MFA_NOT_SUPPORTED` | Cuenta con `mfaEnabled = true` (TOTP fuera de alcance: falla cerrado) |
| 409 | `EMAIL_ALREADY_REGISTERED` | Correo duplicado (sin distinguir mayúsculas) |

## Endpoints

### POST /api/auth/register — 201 (contrato v0.2)
```json
{ "fullName": "Ana Pérez", "email": "ana@empresa.com", "password": "Password123", "organizationName": "Empresa SA" }
```
→ `{ "userId": "uuid", "organizationId": "uuid", "role": "tenant_admin", "verificationRequired": true }`

Crea usuario, organización (`deployment_model = cloud`), membresía con rol `tenant_admin`, hooks (suscripción demo + cuota, Drive personal "Mi espacio" con carpeta "Archivos")
y token de verificación en **una sola transacción**. El correo sale después del commit; si el SMTP falla la cuenta existe y se registra el error sin el token.

### POST /api/auth/login — 200 (contrato v0.2)
```json
{ "email": "ana@empresa.com", "password": "Password123" }
```
```json
{
  "accessToken": "eyJ...",
  "expiresAt": "2026-10-08T15:30:00.000Z",
  "user": { "id": "uuid", "fullName": "Ana Pérez", "email": "ana@empresa.com" },
  "organization": { "id": "uuid", "name": "Empresa SA" },
  "role": "tenant_admin"
}
```
Más cookie `nexus_rt` (HttpOnly, `Path=/api/auth`, 7 días, `Secure` según entorno). El refresh token nunca va en el body y en BD solo existe su hash (`iam.session.refresh_token_hash`). `iam.session` no guarda la organización: al refrescar se vuelve a derivar de la primera membresía activa.

### GET /api/auth/me — 200 (contrato v0.2) · `Authorization: Bearer <accessToken>`
`{ "user": { "id", "fullName", "email" }, "organization": { "id", "name" }, "role": "tenant_admin" }`

### Propuestas (pendientes de aprobación en CONTRACTS.md)
- `POST /api/auth/verify-email` `{ token }` → `200 { "verified": true }`. Un solo uso, 15 min, solo se guarda el hash.
- `POST /api/auth/refresh` (cookie, sin body) → `200` con el esquema del login; rota la cookie. Reutilizar un token ya rotado revoca todas las sesiones del usuario.
- `POST /api/auth/logout` (cookie) → `204`; revoca la sesión y limpia la cookie.

## Integración con frontend (Víctor)
- `accessToken` solo en memoria; nunca en localStorage. `fetch(..., { credentials: 'include' })` en login, refresh y logout.
- Ante 401 en ruta protegida: un intento de `/auth/refresh` y reintento; si falla, ir a login.
- `403 EMAIL_NOT_VERIFIED`: mostrar la pantalla de verificación. Enlace del correo: `${APP_URL}/verificar-correo?token=...` (ruta registrada en `SESSION_LOG.md`; configurable con `IAM_VERIFY_EMAIL_PATH`) → la pantalla debe llamar a `POST /auth/verify-email`. Falta confirmar con Víctor que la página lee `token`. No marcar nada como verificado en la UI sin respuesta 200.
- El `role` es `tenant_admin` / `colaborador` (los nombres de `iam.role`): ajustar maquetas y tipos.

## Configuración y base de datos
- Variables: `docs/proposals/iam-env-additions.md` (para `.env.example`, archivo compartido).
- BD: **IAM no requiere cambios de esquema**. Usa tablas ya migradas: `iam.user`, `iam.role`, `iam.membership`, `iam.session`, `iam.one_time_token` y `admin.organization`. Requiere que `iam.role` tenga las filas `tenant_admin` y `colaborador`.

## Pruebas
- **Prueba de humo contra la API en marcha**: `bash scripts/iam-smoke-test.sh` (registro, verificación leyendo el token de Mailpit, login, `/me`, tenant manipulado, refresh con rotación, logout y comprobaciones en BD). Variables: `API`, `MAIL_API`, `DC`.
- **Unitarias (sin BD)**: `src/modules/iam/iam.services.spec.ts` — 11 casos de `AuthService` y `SessionService` con puertos simulados (`npx jest iam.services`).
- **e2e** (`apps/api/test/iam.e2e-spec.ts`, requiere PostgreSQL de desarrollo y `JWT_SECRET`): registro válido; correo duplicado; datos inválidos y `organizationId` del cliente sin registros parciales; verificación de un solo uso; login válido/inválido uniforme; formato exacto de respuestas y error común; solo hash en `Session`; MFA falla cerrado; `/auth/me` sin sesión; token vencido; tenant manipulado; rotación y reutilización de refresh; logout.

## Dependencias
Sin paquetes fuera de los que IAM ya usa (`@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`) más `argon2` (requerido por ADR/plan) y `nodemailer`
(solo si no existe ya un transporte SMTP para `EmailService`). Dev: `supertest` / `@types/supertest` si faltan. No se agregó `cookie-parser`.

## Pendiente explícito (NO terminado)
- RBAC completo: solo se asigna `tenant_admin`; `colaborador`, invitaciones y permisos por recurso quedan para después.
- `requestPasswordReset` (la tabla `one_time_token` ya admite `password_reset`), bloqueo por intentos fallidos (`failed_login_attempts` / `last_login_at` sin usar), reenvío de verificación (requieren contrato), `verifyTotp` (MFA fuera de alcance), selector de organización activa.
- Rate limiting (`429`) en register/login/refresh; limpieza periódica de sesiones y tokens vencidos.
