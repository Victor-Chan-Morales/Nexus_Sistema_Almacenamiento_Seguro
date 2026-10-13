# Módulo IAM

Identidad, registro, verificación de correo, login, sesión y contexto de organización del monolito.
Código: `apps/api/src/modules/iam` · Prefijo global: `/api` · Responsable: Sebastián.
Contrato: `CONTRACTS.md` v0.2 (las rutas marcadas *propuesta* esperan aprobación, ver `docs/proposals/iam-contracts-patch.md`).

## Capas (ARCHITECTURE.md)
`IamController` (HTTP) → `IamService` (casos de uso) → `IamRepository` (única puerta a PostgreSQL).
Servicios de apoyo: `PasswordService` (Argon2id), `TokenService` (JWT y tokens opacos),
`EmailService` (SMTP; Mailpit/Mailtrap en desarrollo), `RegistrationHooks` (extensión del registro).
IAM no usa Storage ni SeaweedFS.

## Qué exporta
| Export | Uso |
|---|---|
| `JwtAuthGuard` | `@UseGuards(JwtAuthGuard)` en endpoints protegidos |
| `@CurrentUser()` | `AuthUser { userId, organizationId, role, email }`, validado en backend |
| `RegistrationHooks` | Billing/Files se enganchan a la transacción de registro |
| `IamService`, `JwtModule`, `PassportModule` | Compatibilidad con el resto de módulos |

**Regla de tenant:** `organizationId` y `role` salen de JWT + membresía activa revalidada en BD en
cada request. Ninguna ruta lee `organizationId` del body, query o headers; el `ValidationPipe` con
`forbidNonWhitelisted` rechaza campos no declarados.

## Error común (CONTRACTS.md)
Todas las respuestas de error: `{ "code": "ERROR_CODE", "message": "Mensaje seguro", "requestId": "uuid" }`,
producidas por `ApiExceptionFilter` (`src/common/filters`). Sin stack trace ni datos internos.

| HTTP | code | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Datos ausentes, mal formados o campos no permitidos |
| 400 | `INVALID_VERIFICATION_TOKEN` | Token de verificación inválido, usado o vencido |
| 401 | `INVALID_CREDENTIALS` | Correo inexistente, contraseña incorrecta o cuenta suspendida (mismo mensaje) |
| 401 | `INVALID_SESSION` | Refresh token ausente, vencido, revocado o reutilizado |
| 401 | `UNAUTHORIZED` | Sin token, token inválido/vencido o membresía ya no activa |
| 403 | `EMAIL_NOT_VERIFIED` | Contraseña correcta pero correo sin verificar |
| 403 | `NO_ACTIVE_MEMBERSHIP` | Sin organización activa |
| 409 | `EMAIL_ALREADY_REGISTERED` | Correo duplicado (sin distinguir mayúsculas) |

## Endpoints

### POST /api/auth/register — 201 (contrato v0.2)
```json
{ "fullName": "Ana Pérez", "email": "ana@empresa.com", "password": "Password123", "organizationName": "Empresa SA" }
```
→ `{ "userId": "uuid", "organizationId": "uuid", "role": "owner", "verificationRequired": true }`

Crea usuario, organización, membresía `owner`, hooks (suscripción demo + cuota, Drive personal
"Mi espacio" con carpeta "Archivos") y token de verificación en **una sola transacción**.
El correo se envía después del commit; si el SMTP falla la cuenta existe y se registra el error sin el token.

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
  "role": "owner"
}
```
Más cookie `nexus_rt` (HttpOnly, `Path=/api/auth`, 7 días, `Secure` según entorno). El refresh token nunca va en el body.

### GET /api/auth/me — 200 (contrato v0.2) · `Authorization: Bearer <accessToken>`
`{ "user": { "id", "fullName", "email" }, "organization": { "id", "name" }, "role": "owner" }`

### Propuestas (pendientes de aprobación en CONTRACTS.md)
- `POST /api/auth/verify-email` `{ token }` → `200 { "verified": true }`. Un solo uso, vence a los 15 min, se guarda solo el hash.
- `POST /api/auth/refresh` (sin body, usa la cookie) → `200` con el mismo esquema que login; rota la cookie. Reutilizar un token ya rotado revoca todas las sesiones del usuario.
- `POST /api/auth/logout` (usa la cookie) → `204`; revoca el refresh token y limpia la cookie.

## Integración con frontend (Víctor)
- `accessToken` solo en memoria; nunca en localStorage.
- `fetch(..., { credentials: 'include' })` en login, refresh y logout.
- Ante 401 en ruta protegida: un intento de `/auth/refresh` y reintento; si falla, ir a login.
- `403 EMAIL_NOT_VERIFIED`: mostrar la pantalla de verificación. Enlace del correo: `${APP_URL}/verify-email?token=...` → la pantalla llama a `POST /auth/verify-email`. No marcar nada como verificado en la UI sin respuesta 200.
- Estados y textos de error de las pantallas: cotejar con Figma (`docs/FIGMA_MAP.md`).

## Configuración y base de datos
- Variables: `docs/proposals/iam-env-additions.md` (para `.env.example`, archivo compartido).
- BD: `docs/proposals/iam-migration-proposal.sql` es una **propuesta** para el integrador; no se versiona en este PR.

## Pruebas
`apps/api/test/iam.e2e-spec.ts` (requiere PostgreSQL de desarrollo y `JWT_SECRET`): registro válido; correo duplicado;
datos inválidos y `organizationId` del cliente sin registros parciales; verificación de un solo uso; login válido/inválido
con respuesta uniforme; forma exacta de las respuestas y del error común; `/auth/me` sin sesión; token vencido;
tenant manipulado; rotación y reutilización de refresh; logout.

## Dependencias
Sin paquetes nuevos fuera de los que IAM ya declara (`@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`) más:
- `argon2` — requerido por ADR/plan (Argon2id).
- `nodemailer` — solo si el proyecto aún no tiene transporte SMTP para `EmailService`; si ya existe, reutilizarlo.
- Dev: `supertest` / `@types/supertest` si no están (plantilla estándar de Nest).
No se agregó `cookie-parser`: la lectura de la cookie es una función de 10 líneas.

## Pendiente explícito (NO terminado)
- RBAC completo: solo existe el rol inicial `owner`.
- Recuperación de contraseña, reenvío de verificación (requiere contrato), cambio de organización activa.
- Rate limiting (`429`) en register/login/refresh.
- Limpieza periódica de tokens vencidos.
