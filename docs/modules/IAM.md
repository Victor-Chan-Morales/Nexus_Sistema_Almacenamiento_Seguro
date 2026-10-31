# Módulo IAM

Identidad, registro, verificación de correo, login, sesión y contexto de organización del monolito.
Código: `apps/api/src/modules/iam` · Prefijo global: `/api` · Responsable: Sebastián.
Contrato: `CONTRACTS.md` v0.4, aprobado para implementación (ya no hay rutas en estado de propuesta).
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
├─ entities/                  User, Organization, Membership, IamRole, Session, OneTimeToken, EmailOutbox
├─ ports/                     abstracciones: repositorios, UnitOfWork, PasswordHasher, AccessTokenIssuer, OpaqueTokens, VerificationMailer
├─ infrastructure/            TypeORM, Argon2id, JWT, crypto, SMTP (EmailService)
├─ services/                  AuthService, RegistrationService, SessionService, EmailVerificationService,
│                             VerificationTokenService, EmailOutboxService
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

### POST /api/auth/register — 201 (contrato v0.4)
```json
{ "fullName": "Ana Pérez", "email": "ana@empresa.com", "password": "Password123", "organizationName": "Empresa SA" }
```
→ `{ "userId": "uuid", "organizationId": "uuid", "role": "tenant_admin", "verificationRequired": true }`

Crea usuario, organización (`deployment_model = cloud`), membresía con rol `tenant_admin`, hooks (suscripción demo + cuota, Drive personal "Mi espacio" con carpeta "Archivos")
token de verificación y mensaje en la **outbox** (`iam.email_outbox`) en **una sola transacción**. Los hooks obligatorios de Billing (`demo-subscription`, en `modules/billing/registration`) y Files (`personal-drive`, en `modules/files/registration`) están registrados y escriben con el mismo `EntityManager`: si falta alguno o falla, el registro falla y se revierte completo. El correo se envía después del commit; si el SMTP falla, el mensaje queda pendiente y el worker lo reintenta con espera creciente durante 24 horas, y si el token de 15 minutos venció esperando, emite uno nuevo antes de enviar. El token viaja cifrado en la outbox y se borra al enviarse o vencer.

La outbox maneja tres tipos de mensaje (`kind`, CHECK `ck_email_outbox_kind`): `email_verification` (token de 15 min; el reintento lo renueva si venció), `password_reset` (token de 15 min, SPEC-103) y `member_invitation` (token de 24 h, SPEC-102). Los dos últimos **no renuevan** el token: si vence antes de enviarse, el mensaje pasa a `expired` y se vuelve a solicitar. `EmailOutboxService.enqueue(tx, { kind, ... })` encola; el enlace de `password_reset` y `member_invitation` apunta a `/nueva-contrasena?token=...`.

### POST /api/auth/login — 200 (contrato v0.4)
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
Más cookie `nexus_refresh` (HttpOnly, `Path=/api/auth`, 7 días, `Secure` según entorno). El refresh token nunca va en el body y en BD solo existe su hash (`iam.session.refresh_token_hash`). `iam.session.organization_id` guarda la organización activa del login: al refrescar se usa esa misma organización y se revalida su membresía; si ya no está activa, la sesión se rechaza.

### GET /api/auth/me — 200 (contrato v0.4) · `Authorization: Bearer <accessToken>`
`{ "user": { "id", "fullName", "email" }, "organization": { "id", "name" }, "role": "tenant_admin" }`

### Rutas aprobadas en CONTRACTS.md (v0.4)
- `POST /api/auth/verify-email` `{ token }` → `200 { "verified": true }`. Un solo uso, 15 min, solo se guarda el hash.
- `POST /api/auth/refresh` (cookie, sin body) → `200` con el esquema del login; rota la cookie. Reutilizar un token ya rotado revoca todas las sesiones del usuario.
- `POST /api/auth/logout` (cookie) → `204`; revoca la sesión y limpia la cookie.
- `POST /api/auth/login` responde `403 EMAIL_NOT_VERIFIED` si el correo no está verificado (`IAM_REQUIRE_VERIFIED_EMAIL=true`, por defecto).

## Miembros, invitaciones y recuperación de contraseña (SPEC-102, SPEC-103, SPEC-104)

- **Alta** `POST /api/organizations/members` (`MembersService.addMember`, solo `tenant_admin`). El límite se lee antes de la transacción; dentro de ella, bloquea la fila de la organización (`SELECT ... FOR UPDATE`), comprueba el correo (`MEMBER_ALREADY_EXISTS` si ya es miembro de esta organización; `EMAIL_BELONGS_TO_OTHER_ORGANIZATION` si pertenece a otra), comprueba el cupo (`USER_LIMIT_EXCEEDED`), y solo entonces calcula el hash de una contraseña aleatoria inutilizable y crea usuario, membresía activa y la invitación (`enqueueWithToken`: token `password_reset` de **24 h** y mensaje `member_invitation`). El correo sale después del commit. La organización sale solo del token; un `organizationId` en el cuerpo responde `400`.
  - **Decisión aceptada:** el hash de Argon2 se calcula dentro de la transacción, con el bloqueo de la organización tomado. Solo llega ahí un alta válida, y las altas de una misma organización ya se serializan por el bloqueo. Durante una ráfaga de altas, cada una retiene una conexión unos 50–100 ms. Sacarlo del bloqueo obligaría a calcularlo también para las altas rechazadas o a recomprobar tras el hash.
- **Límite de usuarios**: IAM define el puerto `MemberAdmission`. Billing lo rellena en `modules/billing/registration/user-limit.hook.ts` con `plan.maxMembers` de la suscripción vigente. Sin suscripción vigente, o sin fuente registrada, el límite es 0 (falla cerrada). Se lee fuera de la transacción porque la fuente usa otra conexión del pool; leerla dentro podía agotar el pool con altas simultáneas. La fuente usa `BillingService.getActiveSubscriptionReadOnly`, que no escribe: un listado de miembros nunca marca una suscripción vencida. Cuenta solo membresías `active`.
- **Listado** `GET /api/organizations/members` (solo `tenant_admin`, `MembersService.list`): DTO explícito, nunca la entidad `User` ni el hash. `userLimit` es `null` sin plan vigente. `totalMembers` cuenta todas las membresías (también las suspendidas); el cupo solo compara las activas. Sin paginación: se asume un máximo de 100 miembros en este corte.
- **Recuperación** (`PasswordResetService`): `POST /auth/forgot-password` responde antes de tocar la base, así que tarda lo mismo exista o no el correo; la transacción y el envío van en segundo plano, y un fallo se registra sin el correo ni el token. Es una desviación de SPEC-103 §8, que pedía la transacción dentro de la petición. `POST /auth/reset-password` valida el token (hash, propósito, vencimiento, uso) y la política de contraseña, calcula el hash de Argon2id fuera de la transacción, y en una segunda transacción revalida el token con bloqueo, cambia la contraseña, marca `email_verified = true`, consume el token y revoca todas las sesiones.
- **Limitaciones conocidas**:
  - Una recuperación nueva invalida también una invitación pendiente (ambas usan `password_reset`). La salida es "Olvidé mi contraseña".
  - Una invitación pendiente ocupa cupo: la membresía nace `active` y cuenta contra el límite. No hay baja, reenvío ni revocación en este corte (SPEC-102 §3); si cinco personas no aceptan, la organización queda en `USER_LIMIT_EXCEEDED` hasta que se implemente. Pendiente para una spec de seguimiento.
  - Si la base falla dentro del procesamiento de `forgot-password`, el usuario recibe el `200` genérico y no llega correo: debe volver a pedirlo.
  - Tras restablecer, las sesiones (refresh) quedan revocadas, pero un access token ya emitido sigue válido hasta vencer (15 min): `JwtStrategy` valida membresía y organización en cada request, no la sesión.
  - La recuperación no tiene límite de intentos (`429`) en este corte.
  - Las auditorías `MEMBER_ADDED` y `AUTH_PASSWORD_RESET` llegan con SPEC-405.

## Integración con frontend (Víctor)
- `accessToken` solo en memoria; nunca en localStorage. `fetch(..., { credentials: 'include' })` en login, refresh y logout.
- Ante 401 en ruta protegida: un intento de `/auth/refresh` y reintento; si falla, ir a login.
- `403 EMAIL_NOT_VERIFIED`: mostrar la pantalla de verificación. Enlace del correo: `${WEB_URL}/verificar-correo?token=...` (ruta registrada en `SESSION_LOG.md`; configurable con `IAM_VERIFY_EMAIL_PATH`) → la pantalla debe llamar a `POST /auth/verify-email`. Falta confirmar con Víctor que la página lee `token`. No marcar nada como verificado en la UI sin respuesta 200.
- El `role` es `tenant_admin` / `colaborador` (los nombres de `iam.role`): ajustar maquetas y tipos.

## Configuración y base de datos
- Variables: `.env.example` en la raíz (`WEB_URL` es la única variable de origen de la web: CORS y enlace del correo).
- BD: usa `iam.user`, `iam.role`, `iam.membership`, `iam.session`, `iam.one_time_token` y `admin.organization`. La migración `20261019090000` agrega `iam.session.organization_id` y la tabla `iam.email_outbox`; `20261019090100` carga el catálogo de planes (el alta contrata `Demo`). Requiere que `iam.role` tenga las filas `tenant_admin` y `colaborador`. Todas las migraciones viven en `database/migrations/` y se aplican con `docker compose --profile tools run --rm migrate`.

## Pruebas
Ejecutadas el 2026-10-18 en la integración de la PR #6: **53 unitarias y 13 e2e en verde**.

- **Unitarias (sin BD)**: `cd apps/api && npx jest`. Cubren `AuthService`, `SessionService` (incluida la organización de la sesión al refrescar), `EmailVerificationService`, la outbox (cifrado, reintentos, renovación del token y abandono a las 24 h) y el enlace del correo.
- **e2e** (`apps/api/test/iam.e2e-spec.ts`): `cd apps/api && npx jest --config ./test/jest-e2e.json`. Requiere PostgreSQL de desarrollo con las migraciones aplicadas y `JWT_SECRET` en el `.env` de la raíz. Cubre registro válido con los hooks reales (suscripción Demo, Drive `Mi espacio`, carpeta `Archivos` y cuota en cero); rollback completo cuando un hook requerido falla; correo duplicado; datos inválidos y `organizationId` del cliente sin registros parciales; verificación de un solo uso; login válido/inválido uniforme; formato exacto de respuestas y error común; solo hash en `Session`; MFA falla cerrado; `/auth/me` sin sesión, con token vencido y con tenant manipulado; rotación y reutilización de refresh; logout; SMTP caído con reintento; y token vencido durante la caída, renovado al reintentar.
- **Migraciones**: `up`, `down` y `up` de nuevo verificados con dbmate sobre una base limpia.

## Dependencias
Sin paquetes fuera de los que IAM ya usa (`@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`) más `argon2` (requerido por ADR/plan) y `nodemailer`
(solo si no existe ya un transporte SMTP para `EmailService`). Dev: `supertest` / `@types/supertest` si faltan. No se agregó `cookie-parser`.

## Pendiente explícito (NO terminado)
- RBAC completo: solo se asigna `tenant_admin`; `colaborador`, invitaciones y permisos por recurso quedan para después.
- Bloqueo por intentos fallidos (`failed_login_attempts` / `last_login_at` sin usar), reenvío manual de verificación (el reintento ya renueva el token solo; un endpoint de reenvío sigue fuera del corte), `verifyTotp` (MFA fuera de alcance), selector de organización activa.
- Rate limiting (`429`) en register/login/refresh; limpieza periódica de sesiones y tokens vencidos.
