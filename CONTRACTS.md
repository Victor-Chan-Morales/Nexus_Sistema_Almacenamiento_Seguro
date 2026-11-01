# Contratos compartidos de API e integración

> **Versión 0.4 — aprobada para implementación por Víctor, integrador, el 2026-10-18.** Esta versión fija las interfaces que deben seguir las PR de IAM, Billing, Files y frontend. Si una implementación necesita cambiar una ruta, campo o regla, primero se actualiza este documento y `SESSION_LOG.md`.

> **Versión 0.5 — aprobada para implementación por Víctor, coordinador, el 2026-10-28.** Añade las rutas del corte del 80% (RBAC, miembros, recuperación de contraseña, papelera, versiones, facturación, auditoría). Las secciones nuevas están marcadas **[v0.5]**. Si una implementación necesita cambiar una ruta, campo o regla, primero se actualiza este documento. Las decisiones que la sustentan están en `docs/decisions/ADR-007-decisiones-corte-80.md`.

Los tipos del frontend viven en `apps/web/src/lib/api/types.ts`. Son tipos de compilación; la API también debe validar los datos en tiempo de ejecución.

## Reglas comunes

- Prefijo de API: `/api`. La web usa `NEXT_PUBLIC_API_BASE_URL` y no conoce credenciales ni configuración de SeaweedFS.
- JSON para operaciones normales y `multipart/form-data` para carga de archivos.
- Identificadores UUID y fechas ISO-8601 UTC.
- IAM obtiene la organización activa de una membresía válida. El navegador nunca autoriza el tenant enviando `organizationId`.
- Error común: `{ "code": "ERROR_CODE", "message": "Mensaje seguro", "requestId": "uuid" }`. No devolver stack traces, secretos, rutas internas ni datos de otra organización.
- `GET /plans` es público. Las operaciones de organización requieren sesión JWT.
- La activación de planes es simulada: no se piden tarjetas ni se procesa dinero.

## Rutas HTTP

| Módulo | Método y ruta | Entrada | Respuesta aprobada | Responsable |
|---|---|---|---|---|
| IAM | `POST /auth/register` | `{ fullName, email, password, organizationName }` | `{ userId, organizationId, role, verificationRequired }` | Sebastián |
| IAM | `POST /auth/login` | `{ email, password }` | `{ accessToken, expiresAt, user: { id, fullName, email }, organization: { id, name }, role }` | Sebastián |
| IAM | `GET /auth/me` | Bearer token | `{ user, organization, role }` | Sebastián |
| IAM | `POST /auth/verify-email` | `{ token }` | `{ verified: true }` | Sebastián |
| IAM | `POST /auth/refresh` | Cookie `nexus_refresh` | Misma respuesta de sesión que login; renovar cookie | Sebastián |
| IAM | `POST /auth/logout` | Cookie `nexus_refresh` | `204 No Content`; revocar esa sesión y limpiar cookie | Sebastián |
| Billing | `GET /plans` | Sin autenticación | `{ items: [{ id, name, description, priceMonthly, storageLimitBytes, userLimit, validityDays: number \| null }] }` | Anthony |
| Integración Billing/Files | `POST /subscriptions/activate` | Bearer token + `{ planId }` | `{ subscriptionId, status: "active", simulated: true, startDate, endDate }` | Víctor integra; Billing persiste |
| Dashboard | `GET /dashboard` | Bearer token | Respuesta definida en “Dashboard” | Víctor |
| Files | `GET /folders` | Bearer token | `{ drive: { id, name, rootFolderId }, items: [{ id, name, parentFolderId, driveId }] }` | Miguel |
| Files | `POST /folders` | `{ name, parentFolderId? }` | `{ id, name, parentFolderId, driveId, createdAt }` | Miguel |
| Files | `GET /folders/:id/items` | Bearer token | `{ folder: { id, name, parentFolderId, driveId }, folders: [{ id, name, parentFolderId, driveId }], files: [{ id, name, mimeType, sizeBytes, versionId, uploadedAt }] }` | Miguel |
| Files | `POST /files/upload` | Multipart: `folderId`, `file`; opcional `Idempotency-Key` | `{ id, name, mimeType, sizeBytes, versionId, uploadedAt }` | Miguel |
| Files | `GET /files/:id/download` | Bearer token | Bytes del archivo y `Content-Disposition` seguro | Miguel |
| IAM **[v0.5]** | `POST /auth/forgot-password` | `{ email }` | `200 { message }` genérico (exista o no el correo) | Sebastián |
| IAM **[v0.5]** | `POST /auth/reset-password` | `{ token, newPassword }` | `200 { message }`; revoca todas las sesiones | Sebastián |
| IAM **[v0.5]** | `GET /organizations/members` | Bearer token, `tenant_admin` | `{ members: [...], totalMembers, userLimit }` | Sebastián |
| IAM **[v0.5]** | `POST /organizations/members` | `{ fullName, email, role }`, `tenant_admin` | `201 { id, userId, email, fullName, role, status, createdAt }` | Sebastián |
| Files **[v0.5]** | `GET /files/trash` | Bearer token | `{ items: [...], totalItems }` | Miguel |
| Files **[v0.5]** | `POST /files/:id/restore` | Bearer token | `{ id, name, folderId }` | Miguel |
| Files **[v0.5]** | `DELETE /files/:id/purge` | Bearer token | `{ id, freedBytes }` | Miguel |
| Files **[v0.5]** | `GET /files/:id/versions` | Bearer token | `{ fileId, fileName, currentVersion, versions: [...] }` | Miguel |
| Billing **[v0.5]** | `GET /billing/operations` | Bearer token, `tenant_admin` | `{ items: [...] }` | Anthony |
| Integración **[v0.5]** | `POST /subscriptions/renew` | Bearer token, `tenant_admin`, sin cuerpo | Misma respuesta que `activate` | Anthony |
| Audit **[v0.5]** | `GET /audit/events` | Bearer token, `tenant_admin`; `?limit&before` | `{ events: [...], nextBefore }` | Anthony |

## IAM y sesión

- El access token dura **15 minutos** y se guarda solo en memoria. Su `expiresAt` corresponde a esa expiración.
- El refresh token dura **7 días**, se persiste en servidor únicamente como hash y se entrega en una cookie llamada `nexus_refresh` con `HttpOnly`, `SameSite=Lax`, `Path=/api/auth` y `Secure` en producción.
- Cada refresh rota la cookie. Logout revoca la sesión asociada a esa cookie y responde `204`.
- Login y refresh devuelven el mismo formato de sesión: access token, expiración, usuario, organización activa y rol.
- Después de validar correo y contraseña, si la cuenta aún no verificó su correo, `POST /auth/login` responde HTTP `403` con el error común y `code: "EMAIL_NOT_VERIFIED"`. No emite access token ni cookie de refresh en ese caso.
- `POST /auth/verify-email` recibe `{ token }`. El enlace del correo debe abrir `/verificar-correo?token=...`; el token vence en 15 minutos y solo se usa una vez.
- El registro agrega en la misma transacción un mensaje de salida para enviar el correo de verificación. El envío SMTP ocurre después del commit y se reintenta desde una cola/outbox persistente si el proveedor falla; no se revierte una cuenta ya creada por una falla temporal de correo ni se devuelve el token al navegador. No hay endpoint de reenvío manual en este corte.
- Si el token de 15 minutos vence mientras el proveedor SMTP sigue caído, el reintento emite uno nuevo antes de enviar: el enlace que recibe la persona siempre está vigente y una caída temporal del correo no deja la cuenta sin forma de verificarse. Los reintentos se abandonan 24 horas después del registro.
- El enlace del correo se arma con `WEB_URL`, la única variable de origen de la web (la misma que autoriza el CORS).
- El guard JWT valida usuario y membresía, y entrega a controladores `req.user = { userId, email, organizationId, organizationName, role }`. `organizationName` corresponde a la membresía activa validada. Refresh conserva esa organización y comprueba que la membresía siga activa; nunca selecciona otra silenciosamente.
- El cliente web usa `credentials: "include"`. CORS acepta el origen explícito configurado en `WEB_URL`, permite credenciales y expone `Content-Disposition`.
- El registro crea usuario, organización, membresía, suscripción Demo, cuota, Drive `Mi espacio` y carpeta raíz `Archivos` en una sola transacción. Los hooks de Billing y Files usan el mismo `EntityManager`, escriben metadatos en PostgreSQL y no llaman a SeaweedFS. Si un hook falla, se revierte el registro completo. Los hooks requeridos son `demo-subscription` (Billing) y `personal-drive` (Files): si falta uno, el registro falla en lugar de confirmar una cuenta incompleta.

## Billing, planes y cuota

Catálogo aprobado:

| Plan | Precio mensual | Almacenamiento | Usuarios | Vigencia |
|---|---:|---:|---:|---|
| Demo | US$0 | 5 GB (`5000000000` bytes) | 5 | Sin vencimiento; `validityDays: null` |
| Team | US$19.99 | 100 GB (`100000000000` bytes) | 10 | 30 días |
| Business | US$59.99 | 500 GB (`500000000000` bytes) | 30 | 30 días |
| Enterprise | US$149.99 | 2 TB (`2000000000000` bytes) | 100 | 30 días |

- `storageLimitBytes` siempre está expresado en bytes. `priceMonthly` está en USD.
- Demo no expira: la respuesta de activación tiene `endDate: null`. Los planes pagados de demostración vencen 30 días después de `startDate`.
- El estado de suscripción describe su ciclo de vida (`active`, `expired` o `cancelled`). `simulated: true` describe que no hubo cobro; no se usa como estado de ciclo de vida. `getSubscription(organizationId)` devuelve solo una suscripción vigente, o `null`.
- Una organización tiene como máximo una suscripción vigente. Volver a activar el mismo plan devuelve la suscripción vigente y no crea otra. Cambiar de plan reemplaza la anterior dentro de una transacción.
- Un plan menor se rechaza cuando `uso confirmado + reservas de carga activas` supera su límite. No se borran archivos automáticamente.
- Si no existe una suscripción vigente, Billing devuelve un límite de **0 bytes** y Files rechaza nuevas cargas. El flujo normal evita ese estado al crear Demo durante el registro; no se aplica un límite por defecto silencioso.
- La cuota excedida responde `422` con `code: "STORAGE_QUOTA_EXCEEDED"`. Archivo demasiado grande responde `413`; tipo no permitido responde `415`.

### Límite entre Billing y Files

Files expone la lectura interna del uso confirmado:

```ts
getUsedStorageBytes(organizationId: string): Promise<bigint>
```

- Files calcula el uso sumando el tamaño real confirmado de cada versión almacenada del tenant. Se incluyen versiones anteriores conservadas y archivos en papelera durante sus 30 días. No se suma además `FileRecord.sizeBytes`, porque duplicaría la versión actual. La eliminación definitiva libera el espacio al borrar las versiones y sus objetos.
- Las reservas de carga se controlan aparte del uso confirmado. Tanto una carga como una reducción de plan consideran `usedBytes + reservedBytes`; la reserva se crea de forma atómica por organización y se libera al confirmar o fallar la carga.
- Billing es dueño de planes y límites. No consulta tablas de Files. Para evitar una dependencia circular, `POST /subscriptions/activate` lo coordina un `SubscriptionCoordinator` en el módulo de integración: consulta uso/reservas mediante Files, valida el nuevo límite y delega la escritura transaccional a Billing. Files puede seguir usando `BillingService` para obtener el límite al cargar.
- `GET /folders` incluye la unidad Drive `Mi espacio` y su `rootFolderId`; `items` contiene las carpetas hijas de esa raíz. Así el frontend puede consultar la raíz mediante `GET /folders/:rootFolderId/items` sin inventar un UUID especial.
- En `GET /folders/:id/items`, cada archivo representa el registro del archivo y su versión actual: `id` es `FileRecord.id`, `versionId` es la versión actual, `sizeBytes` es el tamaño de esa versión y `uploadedAt` su fecha de carga.

## Dashboard

`GET /dashboard` obtiene el tenant de `req.user`; no acepta organización enviada por el navegador.

```json
{
  "organizationName": "Nombre de organización",
  "plan": {
    "id": "uuid",
    "name": "Demo",
    "storageLimitBytes": 5000000000,
    "userLimit": 5,
    "expiresAt": null,
    "simulated": true
  },
  "storageUsedBytes": 0,
  "storageLimitBytes": 5000000000,
  "recentActivity": []
}
```

- `plan` tiene la forma mostrada o vale `null` si no hay suscripción vigente. En ese caso `storageLimitBytes` es `0`.
- `organizationName` sale del contexto autenticado y validado por IAM; el uso confirmado sale de Files; el plan y el límite salen de Billing.
- Uso y límite se transportan en bytes. El frontend solo los convierte para mostrarlos.
- `simulated` vale `true` mientras no haya cobro real. `recentActivity` es `[]` hasta que exista una fuente de Auditoría.
- Todos los valores enteros de bytes de la respuesta caben en el rango seguro de `number` de JavaScript para los planes definidos.

## Files, almacenamiento y errores

- El navegador se comunica solo con la API Nexus. No conoce SeaweedFS, bucket, claves de objeto ni credenciales.
- Máximo inicial por archivo: 100 MB (`100000000` bytes). Tipos iniciales: PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT y ZIP. Máximo inicial: 3 cargas simultáneas por usuario.
- Repetir una carga con el mismo nombre en la misma carpeta crea una nueva versión del mismo archivo. La clave de objeto la genera el backend y no contiene el nombre original.
- `Idempotency-Key` hace que un reintento de la misma operación no cree un archivo o versión duplicados.
- Una carga responde éxito solo cuando los bytes y metadatos están confirmados. Si falla la base después de guardar el objeto, Files intenta eliminar el objeto huérfano y devuelve error seguro.
- Una organización ajena se trata como inexistente (`404`) en listados, carga, descarga y operaciones de archivo.
- Errores HTTP comunes: `400` entrada inválida; `401` sin sesión válida; `403` rol o estado no habilita; `404` recurso inexistente o ajeno; `409` conflicto; `413` archivo demasiado grande; `415` tipo no permitido; `422` regla de negocio o cuota; `429` límite de intentos/carga; `500` error inesperado seguro.

## Roles y autorización [v0.5]

- Valores de rol en JWT, BD y API: `tenant_admin` y `colaborador`. Super Admin es el flag `is_super_admin`, no un rol. Auditor no se implementa en este corte.
- `@Roles(...)` + `RolesGuard` (IAM) leen `req.user.role`, que `JwtStrategy` ya toma de la membresía activa en cada request. Un endpoint sin `@Roles` solo exige sesión.
- Rol insuficiente → `403` con el error común y `code: "FORBIDDEN_ROLE"`. El cuerpo no incluye la lista de roles requeridos.
- Matriz del corte (fuente: ADR-007 §4):

| Endpoint | Rol |
|---|---|
| `POST` y `GET /organizations/members` | `tenant_admin` |
| `GET /audit/events` | `tenant_admin` |
| `POST /subscriptions/activate`, `POST /subscriptions/renew`, `GET /billing/operations` | `tenant_admin` |
| Resto de rutas autenticadas | cualquier miembro |

- Cambio de comportamiento: `POST /subscriptions/activate` deja de estar abierto a `colaborador`.

## Recuperación de contraseña [v0.5]

- `POST /auth/forgot-password` `{ email }` → siempre `200 { "message": "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña." }`. Si el correo existe y la cuenta está activa se encola un correo; si no, no se envía nada y la respuesta es idéntica. Emitir un token nuevo invalida los anteriores sin usar.
- El enlace abre `/nueva-contrasena?token=...` (se arma con `WEB_URL`). El token vence en **15 minutos**, es de un solo uso y se guarda como hash.
- `POST /auth/reset-password` `{ token, newPassword }` → `200 { "message": "Contraseña actualizada. Ya puedes iniciar sesión." }`. Token inválido, vencido o usado → `400` con `code: "INVALID_OR_EXPIRED_TOKEN"`. Contraseña que no cumple la política → `400 VALIDATION_ERROR`. Argon2id.
- Al restablecer: se **revocan todas las sesiones** del usuario, el token queda usado y la cuenta queda con `email_verified = true` (el enlace prueba que controla el buzón).
- El outbox de correo admite los `kind`: `email_verification`, `password_reset`, `member_invitation`. Los dos nuevos no emiten token nuevo en el reintento: si su token vence, el mensaje se abandona.
- `POST /auth/forgot-password` no tiene límite de intentos en este corte (limitación declarada): un abuso podría llenar el outbox de correos. El límite por IP o correo (`429`) queda para el 100%.

## Miembros de la organización [v0.5]

`GET /organizations/members` (solo `tenant_admin`):

```json
{
  "members": [
    { "id": "uuid", "userId": "uuid", "fullName": "Nombre", "email": "correo@dominio.com", "role": "tenant_admin", "status": "active", "joinedAt": "ISO-8601" }
  ],
  "totalMembers": 1,
  "userLimit": 5
}
```

`userLimit` viene del plan vigente (`null` si no hay suscripción vigente).

`POST /organizations/members` (solo `tenant_admin`): cuerpo `{ "fullName": "...", "email": "...", "role": "tenant_admin" | "colaborador" }`. Respuesta `201`: `{ id, userId, email, fullName, role, status: "active", createdAt }`. Crea la cuenta con contraseña aleatoria inutilizable y encola un correo `member_invitation` con un enlace a `/nueva-contrasena?token=...` de **24 h**.

**Invitación vencida:** el administrador no puede reinvitar (`MEMBER_ALREADY_EXISTS`) y el reintento del outbox no emite token nuevo. La salida es que la persona use **"Olvidé mi contraseña"** (`POST /auth/forgot-password`), que emite un token de 15 minutos y deja la cuenta verificada. Es el comportamiento previsto, no un error; la pantalla de miembros debe indicarlo.

| HTTP | `code` | Causa |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Cuerpo inválido (correo, nombre, rol). |
| 403 | `FORBIDDEN_ROLE` | El solicitante no es `tenant_admin`. |
| 422 | `MEMBER_ALREADY_EXISTS` | Ya es miembro de esta organización. |
| 422 | `EMAIL_BELONGS_TO_OTHER_ORGANIZATION` | El correo ya existe en otra organización. |
| 422 | `USER_LIMIT_EXCEEDED` | La organización alcanzó el límite de usuarios del plan (o no hay plan vigente). |

## Papelera y versiones [v0.5]

Todas estas rutas se acotan al **Drive personal del solicitante** y tratan un archivo ajeno o inexistente como `404`.

- `GET /files/trash` → `{ "items": [{ "id", "name", "mimeType", "sizeBytes", "deletedAt", "retentionEndsAt" }], "totalItems" }`. Solo archivos eliminados; `sizeBytes` es el de la versión actual; `retentionEndsAt` = `deletedAt` + 30 días (informativo: no hay purga automática).
- `POST /files/:id/restore` → `200 { "id", "name", "folderId" }`. `404` si no está en la papelera del solicitante; `409 FILE_NAME_CONFLICT` si la carpeta ya tiene un archivo activo con ese nombre; `409 PARENT_FOLDER_UNAVAILABLE` si la carpeta ya no está disponible. `422 STORAGE_QUOTA_EXCEEDED` si el archivo lleva más de 30 días en la papelera (ya no cuenta para la cuota) y al restaurarlo se supera el límite del plan; en ese caso el archivo sigue en la papelera.
- `DELETE /files/:id/purge` → `200 { "id", "freedBytes" }`. `freedBytes` es la suma de **todas** las versiones. `422 CANNOT_PURGE_ACTIVE_FILE` si el archivo no está en la papelera. Borra metadatos y versiones en una transacción (reescribe los contadores de cuota) y elimina los objetos de SeaweedFS **después** del commit, con mejor esfuerzo: un objeto que no se pudo borrar queda huérfano y se registra, nunca al revés.
- `GET /files/:id/versions` → `{ "fileId", "fileName", "currentVersion", "versions": [{ "versionId", "versionNumber", "sizeBytes", "uploadedAt", "isCurrent" }] }`, de la más reciente a la más antigua. Solo archivos activos.
- Cuota (sin cambio respecto de v0.4): un archivo eliminado sigue contando para la cuota **durante 30 días desde `deleted_at`**; pasado ese plazo deja de contar aunque sus objetos sigan almacenados hasta la purga. No hay purga automática en este corte, así que `retentionEndsAt` indica cuándo deja de contar, no cuándo se borra.

## Facturación: historial y renovación [v0.5]

- `GET /billing/operations` (solo `tenant_admin`) → `{ "items": [{ "id", "type": "charge" | "renewal", "planName", "amount", "simulated": true, "occurredAt" }] }`, más recientes primero, máximo 100. `amount` es USD (número; el mapper convierte el `numeric` de PostgreSQL, que llega como cadena). Se resuelve por la suscripción de la organización del token.
- `POST /subscriptions/activate` escribe una operación `charge` (monto del plan) cuando **crea** una suscripción. Reactivar el mismo plan no escribe nada. Todo cambio de plan crea una suscripción nueva y por tanto escribe un `charge` con el precio del plan destino, incluso US$0 (por ejemplo, bajar de Team a Demo). El hook `demo-subscription` del alta de la organización escribe un `charge` de US$0 dentro de la transacción del registro. La reducción de plan sigue respondiendo `422 STORAGE_QUOTA_EXCEEDED` (no existe `DOWNGRADE_STORAGE_EXCEEDED`).
- `POST /subscriptions/renew` (solo `tenant_admin`, sin cuerpo): extiende la vigencia de la suscripción vigente en `validityDays` desde `max(hoy, fin actual)` y escribe una operación `renewal`. No crea otra suscripción. Respuesta igual a `activate` (`{ subscriptionId, status: "active", simulated: true, startDate, endDate }`). `422 NO_ACTIVE_SUBSCRIPTION` sin suscripción vigente; `422 PLAN_NOT_RENEWABLE` para planes sin vigencia (Demo).

## Auditoría [v0.5]

`GET /audit/events?limit=50&before=<ISO-8601>` (solo `tenant_admin`): `limit` por defecto 50, máximo 100; `before` pagina por `occurredAt`.

```json
{
  "events": [
    { "id": "uuid", "action": "FILE_UPLOAD", "resourceType": "file", "resourceId": "uuid", "actorId": "uuid", "result": "success", "occurredAt": "ISO-8601" }
  ],
  "nextBefore": "ISO-8601 | null"
}
```

- Acciones del corte: `AUTH_LOGIN`, `AUTH_PASSWORD_RESET`, `MEMBER_ADDED`, `FILE_UPLOAD`, `FILE_DOWNLOAD`, `FILE_DELETE`, `FILE_RESTORE`, `FILE_PURGE`, `PLAN_ACTIVATED`, `PLAN_RENEWED`. Tipos de recurso: `user`, `membership`, `file`, `subscription`.
- El evento no incluye nombres de archivo ni datos personales. El frontend resuelve `actorId` a nombre con `GET /organizations/members` (misma audiencia: solo administradores).
- Cada evento guarda `record_hash` y `prev_hash` desde el primer registro. La verificación de cadena y los checkpoints firmados quedan fuera de este corte.
- El registro de auditoría es de mejor esfuerzo y posterior al commit de la operación: si falla, la operación principal no se ve afectada.
- `recentActivity` del Dashboard sigue siendo `[]` en este corte.

## Códigos de error [v0.5]

Catálogo común. El filtro emite `VALIDATION_ERROR` para cualquier `400` de validación (no existe `VALIDATION_FAILED`).

| HTTP | `code` | Uso |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Entrada inválida. |
| 400 | `INVALID_OR_EXPIRED_TOKEN` | Token de recuperación inválido, vencido o usado. |
| 401 | `UNAUTHORIZED` | Sin sesión válida (token ausente, inválido o vencido). |
| 403 | `FORBIDDEN_ROLE` | Rol insuficiente. |
| 403 | `EMAIL_NOT_VERIFIED` | Login sin correo verificado (v0.4). |
| 404 | `NOT_FOUND` | Recurso inexistente o ajeno. |
| 409 | `FILE_NAME_CONFLICT`, `PARENT_FOLDER_UNAVAILABLE`, `CONCURRENT_SUBSCRIPTION_CONFLICT` | Conflicto de estado. |
| 422 | `STORAGE_QUOTA_EXCEEDED`, `MEMBER_ALREADY_EXISTS`, `EMAIL_BELONGS_TO_OTHER_ORGANIZATION`, `USER_LIMIT_EXCEEDED`, `CANNOT_PURGE_ACTIVE_FILE`, `NO_ACTIVE_SUBSCRIPTION`, `PLAN_NOT_RENEWABLE` | Regla de negocio. |

## Cambios de forma en Files ya implementados [v0.5]

Documentan lo que el código ya devuelve (arreglo de tamaño de carpetas, SPEC-001/201):

- En `GET /folders` y `GET /folders/:id/items`, cada carpeta (incluida `folder`) añade `createdAt` (ISO-8601) y `sizeBytes` (número): suma del tamaño de la versión actual de los archivos **activos** de la carpeta y sus subcarpetas.
- `sizeBytes` de archivos (`UploadedFileDto`) es **número**, no cadena.

## Implementación y cambios futuros

- IAM implementa identidad, cookies, refresh y el contexto autenticado; Billing implementa catálogo y persistencia de suscripción; Files implementa objetos, versiones, uso y reservas; Víctor implementa Dashboard, coordinador de activación y frontend.
- Las migraciones compartidas se consolidan en una sola ubicación y se presentan en un solo PR integrador, según `CONTRIBUTING.md`.
- La ubicación canónica es `database/migrations/` en la raíz del repositorio. Los PR de dominio entregan sus cambios de esquema al integrador; no dupliquen la misma migración en `apps/db/database/migrations/`.
- MFA/TOTP queda fuera del alcance actual. **[v0.5]** Recuperación de contraseña y RBAC entran en el corte del 80% según las secciones marcadas **[v0.5]**.
