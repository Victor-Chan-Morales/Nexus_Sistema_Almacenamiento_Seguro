# Contratos compartidos de API e integración

> **Versión 0.4 — aprobada para implementación por Víctor, integrador, el 2026-10-18.** Esta versión fija las interfaces que deben seguir las PR de IAM, Billing, Files y frontend. Si una implementación necesita cambiar una ruta, campo o regla, primero se actualiza este documento y `SESSION_LOG.md`.

> **Versión 0.5 — aprobada para implementación por Víctor, coordinador, el 2026-10-28.** Añade las rutas del corte del 80% (RBAC, miembros, recuperación de contraseña, papelera, versiones, facturación, auditoría). Las secciones nuevas están marcadas **[v0.5]**. Si una implementación necesita cambiar una ruta, campo o regla, primero se actualiza este documento. Las decisiones que la sustentan están en `docs/decisions/ADR-007-decisiones-corte-80.md`.

> **Versión 0.6 — aplica `docs/decisions/ADR-008-alcance-final.md`, aprobado por Víctor, coordinador, el 2026-11-04.** Las reglas marcadas **[v0.6]** son el contrato acordado. Cada una indica la spec que la implementa: hasta que esa spec se fusione, el código puede seguir con la regla anterior. Cada spec nueva agrega sus rutas en la sección "Alcance final [v0.6]" antes de programar.

Los tipos del frontend viven en `apps/web/src/lib/api/types.ts`. Son tipos de compilación; la API también debe validar los datos en tiempo de ejecución.

## Reglas comunes

- Prefijo de API: `/api`. La web usa `NEXT_PUBLIC_API_BASE_URL` y no conoce credenciales ni configuración de SeaweedFS.
- JSON para operaciones normales y `multipart/form-data` para carga de archivos.
- Identificadores UUID y fechas ISO-8601 UTC.
- IAM obtiene la organización activa de una membresía válida. El navegador nunca autoriza el tenant enviando `organizationId`.
- Error común: `{ "code": "ERROR_CODE", "message": "Mensaje seguro", "requestId": "uuid" }`. No devolver stack traces, secretos, rutas internas ni datos de otra organización.
- `GET /plans` es público. Las operaciones de organización requieren sesión JWT.
- La activación y la renovación de planes son simuladas: no se procesa dinero real. **[v0.6, SPEC-305]** Con precio mayor que cero solicitan una tarjeta de prueba (ADR-008 §5).

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
| Files | `DELETE /folders/:id` | ****** | `{ success, id }`; mueve el árbol a la papelera | Miguel |
| Files | `POST /folders/:id/restore` | ****** | `{ id, name, parentFolderId }`; restaura el árbol como unidad | Miguel |
| Files | `DELETE /folders/:id/purge` | ****** | `{ id, freedBytes }`; purga todo el árbol | Miguel |
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

- Files calcula el uso sumando el tamaño real confirmado de cada versión almacenada del tenant. Se incluyen versiones anteriores conservadas y **[v0.6, SPEC-215]** archivos en papelera hasta su eliminación física. No se suma además `FileRecord.sizeBytes`, porque duplicaría la versión actual. La eliminación definitiva libera el espacio al borrar las versiones y sus objetos.
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
| `POST /teams`, `GET` y `POST /teams/:id/members`, `PATCH` y `DELETE /teams/:id/members/:userId` **[v0.6, SPEC-220]** | `tenant_admin` |
| `POST /subscriptions/activate`, `POST /subscriptions/renew`, `GET /billing/operations` | `tenant_admin` |
| `PUT /organizations/storage-policy`, `POST` y `GET /organizations/installation-requests` **[v0.6, SPEC-803]** | `tenant_admin` |
| `GET /organizations/storage-policy` **[v0.6, SPEC-803]** (solo lectura para el colaborador) | cualquier miembro |
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

Todas estas rutas se acotan al **Drive personal del solicitante** y tratan un recurso ajeno o inexistente como `404`. **[v0.6, SPEC-222]** También alcanzan los Drives de equipo accesibles.

- `GET /files/trash` → `{ "items": [...], "totalItems" }`. Cada elemento indica `kind: "file" | "folder"`. Un archivo contiene `{ id, name, mimeType, sizeBytes, deletedAt, retentionEndsAt }`; una carpeta raíz de papelera contiene `{ id, name, parentFolderId, sizeBytes, deletedAt, retentionEndsAt }`. `sizeBytes` de carpeta suma la versión actual de cada archivo del árbol. `retentionEndsAt` = `deletedAt` + 30 días. **[v0.6, SPEC-215]** Es la fecha de borrado; puede aparecer en el pasado hasta el siguiente ciclo de la tarea. Los archivos dentro de un árbol de carpeta no se listan por separado.
- `POST /files/:id/restore` → `200 { "id", "name", "folderId" }`. `404` si no está en la papelera del solicitante; `409 FILE_NAME_CONFLICT` si la carpeta ya tiene un archivo activo con ese nombre; `409 PARENT_FOLDER_UNAVAILABLE` si la carpeta ya no está disponible. **[v0.6, SPEC-215]** Restaurar no vuelve a verificar la cuota, porque el archivo ya la consumía.
- `DELETE /files/:id/purge` → `200 { "id", "freedBytes" }`. `freedBytes` es la suma de **todas** las versiones. `422 CANNOT_PURGE_ACTIVE_FILE` si el archivo no está en la papelera. Borra metadatos y versiones en una transacción (reescribe los contadores de cuota) y elimina los objetos de SeaweedFS **después** del commit, con mejor esfuerzo: un objeto que no se pudo borrar queda huérfano y se registra, nunca al revés.
- `DELETE /folders/:id` mueve la carpeta y todo su árbol de descendientes a la papelera como una unidad con una fecha de eliminación común. La raíz del Drive no se puede eliminar.
- `POST /folders/:id/restore` restaura el árbol y los archivos que se eliminaron junto con él; los archivos y subcarpetas que ya estaban eliminados individualmente conservan su fecha y permanecen en la papelera. `409 FOLDER_NAME_CONFLICT` si el nombre raíz está ocupado; `409 PARENT_FOLDER_UNAVAILABLE` si su carpeta contenedora no está activa. Si falla, el árbol sigue en la papelera. **[v0.6, SPEC-215]** Restaurar no vuelve a verificar la cuota.
- `DELETE /folders/:id/purge` elimina definitivamente la carpeta y todo su contenido, libera la suma de todas las versiones y borra objetos de SeaweedFS después del commit con mejor esfuerzo. La interfaz requiere confirmación explícita.
- `GET /files/:id/versions` → `{ "fileId", "fileName", "currentVersion", "versions": [{ "versionId", "versionNumber", "sizeBytes", "uploadedAt", "isCurrent" }] }`, de la más reciente a la más antigua. Solo archivos activos.
- Cuota **[v0.6, SPEC-215]** (enmienda v0.4 y v0.5 según ADR-008 §9): todo lo que está en la papelera cuenta en la cuota **hasta su eliminación física**. Una tarea periódica purga lo que supera 30 días.

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

- Acciones del corte: `AUTH_LOGIN`, `AUTH_PASSWORD_RESET`, `MEMBER_ADDED`, `FILE_UPLOAD`, `FILE_DOWNLOAD`, `FILE_DELETE`, `FILE_RESTORE`, `FILE_PURGE`, `FILE_VERSION_RESTORED` **[v0.6, SPEC-210]**, `SHARE_LINK_CREATED` **[v0.6, SPEC-209]**, `SHARE_LINK_REVOKED` **[v0.6, SPEC-209]**, `DESTINATION_CREATED` **[v0.6, SPEC-802]**, `DESTINATION_UPDATED` **[v0.6, SPEC-802]**, `DESTINATION_TESTED` **[v0.6, SPEC-802]** (con `result: failure` y `safe_reason` = `AUTH`, `NETWORK`, `BUCKET_NOT_FOUND` o `DATA_MISMATCH` cuando la conexión falla; `success` cuando conecta), `TEAM_CREATED`, `TEAM_MEMBER_ADDED`, `TEAM_MEMBER_LEVEL_CHANGED`, `TEAM_MEMBER_REMOVED` **[v0.6, SPEC-220]**, `FOLDER_CREATE`, `FOLDER_DELETE`, `FOLDER_RESTORE`, `FOLDER_PURGE`, `PLAN_ACTIVATED`, `PLAN_RENEWED`, `DEPLOYMENT_MODEL_CHANGED` **[v0.6, SPEC-803]**, `INSTALLATION_REQUESTED` **[v0.6, SPEC-803]**. Tipos de recurso: `user`, `membership`, `file`, `folder`, `subscription`, `share_link` **[v0.6, SPEC-209]**, `destination` **[v0.6, SPEC-802]**, `team` **[v0.6, SPEC-220]**, `organization` **[v0.6, SPEC-803]**, `installation_request` **[v0.6, SPEC-803]**.
- El evento no incluye nombres de archivo ni datos personales. El frontend resuelve `actorId` a nombre con `GET /organizations/members` (misma audiencia: solo administradores).
- Cada evento guarda `record_hash` y `prev_hash` desde el primer registro. **[v0.6]** La verificación de cadena llega con SPEC-404; los checkpoints firmados no se implementan (ADR-008 §10).
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
| 409 | `FILE_NAME_CONFLICT`, `FOLDER_NAME_CONFLICT`, `PARENT_FOLDER_UNAVAILABLE`, `CONCURRENT_SUBSCRIPTION_CONFLICT`, `TEAM_NAME_CONFLICT` **[v0.6, SPEC-220]**, `TEAM_MEMBER_EXISTS` **[v0.6, SPEC-220]**, `INSTALLATION_REQUEST_PENDING` **[v0.6, SPEC-803]** | Conflicto de estado. |
| 422 | `STORAGE_QUOTA_EXCEEDED`, `VERSION_ALREADY_CURRENT` **[v0.6, SPEC-210]**, `USER_NOT_IN_ORGANIZATION` **[v0.6, SPEC-220]**, `MEMBER_ALREADY_EXISTS`, `EMAIL_BELONGS_TO_OTHER_ORGANIZATION`, `USER_LIMIT_EXCEEDED`, `CANNOT_PURGE_ACTIVE_FILE`, `NO_ACTIVE_SUBSCRIPTION`, `PLAN_NOT_RENEWABLE`, `DEPLOYMENT_MODEL_REQUIREMENTS_UNMET` **[v0.6, SPEC-803]**, `DESTINATION_SELECTION_NOT_ALLOWED` **[v0.6, SPEC-803]**, `DESTINATION_NOT_AVAILABLE` **[v0.6, SPEC-803]** | Regla de negocio. |

## Cambios de forma en Files ya implementados [v0.5]

Documentan lo que el código ya devuelve (arreglo de tamaño de carpetas, SPEC-001/201):

- En `GET /folders` y `GET /folders/:id/items`, cada carpeta (incluida `folder`) añade `createdAt` (ISO-8601) y `sizeBytes` (número): suma del tamaño de la versión actual de los archivos **activos** de la carpeta y sus subcarpetas.
- `sizeBytes` de archivos (`UploadedFileDto`) es **número**, no cadena.

## Alcance final [v0.6]

- **[v0.6, SPEC-211]** `PATCH /files/:id` acepta `{ name?, folderId? }`; `PATCH /folders/:id` acepta `{ name?, parentId? }`. Se requiere al menos un campo. Responden `200` con el formato de listado y conservan versiones y enlaces. Los conflictos de nombre responden `409 FILE_NAME_CONFLICT` o `FOLDER_NAME_CONFLICT`; los ciclos, otro almacén, la raíz o la papelera responden `422 FOLDER_CYCLE_NOT_ALLOWED`, `DESTINATION_MISMATCH` o `RESOURCE_NOT_MOVABLE`. Otro Drive o un recurso ajeno responde `404`. El nivel de solo lectura recibe `403 DRIVE_PERMISSION_DENIED`. Se auditan los cambios efectivos con `FILE_RENAMED`, `FILE_MOVED`, `FOLDER_RENAMED` y `FOLDER_MOVED`, sin incluir nombres.

- **[v0.6, SPEC-224]** En Drives de equipo, `write` permite crear carpetas, cargar, enviar a papelera, restaurar archivos, carpetas y versiones y administrar enlaces. Un miembro `read` recibe `403 DRIVE_PERMISSION_DENIED`. Solo un `tenant_admin` puede purgar definitivamente en un Drive de equipo. El dueño de un Drive personal conserva sus permisos. Los recursos de Drives ajenos responden `404`. Las cargas de equipo consumen cuota de la organización y cada versión y evento de auditoría conserva el usuario que realizó la acción.

- **[v0.6, SPEC-222]** `GET /drives` devuelve `{ items: [{ id, name, type, teamId, rootFolderId, myLevel }] }`. El Drive personal es de su dueño (`owner`). Un miembro ve los Drives de sus equipos con su nivel `read` o `write`. Un administrador ve los Drives de equipo de su organización con nivel `write`.
- **[v0.6, SPEC-222]** `GET /folders` y `GET /files/trash` aceptan `driveId` opcional. Sin él usan el Drive personal. La consulta de una carpeta o archivo por ID resuelve el Drive del recurso para navegar, descargar y consultar versiones. Un Drive ajeno o de otra organización, o un equipo del que se quitó al miembro, responde `404`. Un lector recibe `403 DRIVE_PERMISSION_DENIED` al administrar enlaces. La escritura de archivos y carpetas en equipo corresponde a SPEC-224.

- **[v0.6, SPEC-218]** `POST /folders` recorta el nombre y responde `409 FOLDER_NAME_CONFLICT` si una carpeta activa ya lo usa bajo el mismo padre, sin distinguir mayúsculas. `POST /folders/:id/restore` aplica la misma regla. Los nombres de carpetas en papelera no reservan el nombre.

- **[v0.6, SPEC-404]** `GET /audit/verify` (solo `tenant_admin`) comprueba la cadena de la organización de la sesión y devuelve `200 { valid, checkedEvents, firstBrokenEventId, reason, verifiedAt }`. `checkedEvents` incluye el primer evento inconsistente. Una cadena íntegra devuelve `null` en `firstBrokenEventId` y `reason`. Los motivos posibles son `SEQUENCE_GAP`, `PREV_HASH_MISMATCH` y `HASH_MISMATCH`. El borrado de los eventos finales no es detectable sin un checkpoint firmado.

- **[v0.6, SPEC-216]** `GET /public/share-links/:token` sin sesión devuelve `{ requiresPassword, expiresAt }` y, solo para enlaces sin contraseña, `{ name, sizeBytes, mimeType }` de la versión fija. `POST /public/share-links/:token/download` con `{ password? }` devuelve los bytes de esa versión como adjunto. Enlace no disponible → `404 SHARE_LINK_UNAVAILABLE`; contraseña incorrecta o ausente → `401 SHARE_LINK_PASSWORD_INVALID`; cinco fallos por enlace e IP en 15 minutos → `429 TOO_MANY_ATTEMPTS` en los siguientes intentos. Las rutas públicas aplican `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` y `Cache-Control: no-store`. La descarga y los fallos de contraseña emiten `SHARE_LINK_ACCESSED` con actor visitante, sin token, contraseña ni IP.

Cada spec agrega aquí sus rutas, campos y códigos de error antes de programar.

- **[v0.6, SPEC-210]** `GET /files/:id/versions/:versionId/download` → bytes exactos de esa versión, `Content-Type` del archivo y `Content-Disposition: attachment` con nombre seguro. Solo archivos propios, activos y con carpeta activa. Otro archivo, versión ajena, archivo en papelera o inexistente → `404`. `id` o `versionId` que no son UUID → `400`. Emite `FILE_DOWNLOAD`.
- **[v0.6, SPEC-210]** `POST /files/:id/versions/:versionId/restore` (sin cuerpo) → `200 { "fileId", "versionId", "versionNumber", "sizeBytes", "uploadedAt" }`. Crea una versión nueva con el contenido de la indicada, que pasa a ser la vigente; las anteriores se conservan. Reutiliza la carga multiparte (cuota, cifrado y compensación). Errores: `404` como arriba, también si el archivo entra en papelera mientras se restaura (no crea nada); `400` si `id` o `versionId` no son UUID; `422 VERSION_ALREADY_CURRENT` si la versión indicada ya es la vigente o su contenido es igual al de la vigente (comparación por SHA-256); `422 STORAGE_QUOTA_EXCEEDED` si no cabe en la cuota (no crea nada). Emite `FILE_UPLOAD` y `FILE_VERSION_RESTORED`, ambos con el mismo `correlationId`.
- **[v0.6, SPEC-209]** `POST /files/:id/share-links` con `{ "expiresInDays": 1 | 7 | 30, "password"?: string }` (contraseña de 8 a 128 caracteres, sin exigir letras ni números) → `201 { "id", "token", "versionId", "expiresAt", "hasPassword", "createdAt" }`. El enlace apunta a la versión vigente en el momento de crearlo y no cambia después. `token` aparece solo en esta respuesta: la base guarda su hash SHA-256 y la contraseña en Argon2id. `expiresInDays` distinto de 1, 7 o 30, o campos no declarados → `400 VALIDATION_ERROR`. `id` que no es UUID → `400`. Archivo ajeno, de otra organización, inexistente, en papelera o con acceso de solo lectura → `404`. Emite `SHARE_LINK_CREATED`.
- **[v0.6, SPEC-209]** `GET /files/:id/share-links` → `{ "items": [{ "id", "versionId", "expiresAt", "hasPassword", "status", "createdAt", "revokedAt" }] }`, del más reciente al más antiguo. `status` es `active`, `expired` (vencido) o `revoked` (revocado; prevalece sobre vencido). No incluye el token ni su hash. Mismos errores que la creación.
- **[v0.6, SPEC-209]** `DELETE /share-links/:id` → `204`. Revoca el enlace de forma definitiva; repetirlo también responde `204` sin cambiar `revokedAt` ni volver a auditar. Enlace ajeno, de otra organización o inexistente → `404`; `id` que no es UUID → `400`. Funciona aunque el archivo esté en papelera. Emite `SHARE_LINK_REVOKED`.
- **[v0.6, SPEC-802]** Todas las rutas de destinos son solo para `tenant_admin`; un colaborador recibe `403 FORBIDDEN_ROLE`. Un destino de otra organización o inexistente → `404`; `id` que no es UUID → `400`.
- **[v0.6, SPEC-802]** `POST /destinations` con `{ name, location: "cloud" | "on_premises", providerType: "s3" | "minio", endpoint, bucket, region, accessKey, secretKey, useSsl }` → `201 DestinationDto` con `connectionStatus: "Sin comprobar"`. Las credenciales se guardan cifradas en `connection_details_encrypted` y ninguna respuesta, log ni evento las incluye. Emite `DESTINATION_CREATED`.
- **[v0.6, SPEC-802]** `DestinationDto` = `{ id, name, location, providerType, endpoint, bucket, region, connectionStatus, isEnabled, isDefault, createdAt }`. `connectionStatus` es `Sin comprobar`, `Comprobando`, `Conectado` o `Sin conexión`. En destinos de entorno (configurados con `S3_*` en el servidor) `endpoint` y `region` son `null`: esa configuración no se expone al tenant. Sus datos de conexión no se pueden reemplazar desde la API; `PATCH` con `endpoint`, `bucket`, `region`, `accessKey`, `secretKey` o `useSsl` responde `400 VALIDATION_ERROR`, y sí admite `name`, `location` e `isEnabled`.
- **[v0.6, SPEC-802]** `GET /destinations` → `{ "items": DestinationDto[] }`.
- **[v0.6, SPEC-802]** `PATCH /destinations/:id` con cualquiera de los campos de creación, `isEnabled` o ambos → `200 DestinationDto`. Devuelve `connectionStatus` a `Sin comprobar`. Una `secretKey` omitida conserva la actual. Emite `DESTINATION_UPDATED`.
- **[v0.6, SPEC-802]** `PATCH /destinations/:id` con `{ "isEnabled": false }` impide escribir en el destino, pero sus archivos siguen leyéndose. Deshabilitar el destino predeterminado o uno asignado a carpetas activas → `422 DESTINATION_IN_USE`.
- **[v0.6, SPEC-802]** `POST /destinations/:id/test` → `200 { "status", "checkedAt", "reason" }`. Escribe, lee, compara y borra `.nexus-connection-test/<uuid>` con un límite de 10 s. `status` pasa a `Conectado` o a `Sin conexión`; `reason` es `AUTH`, `NETWORK`, `BUCKET_NOT_FOUND` o `DATA_MISMATCH` (`null` si conecta), nunca el mensaje crudo del SDK. Un destino deshabilitado responde `409`. Si el endpoint ya no es válido al probar (p. ej. su DNS apunta a loopback), responde `422 DESTINATION_ENDPOINT_NOT_ALLOWED` sin conectarse y sin cambiar el estado. Emite `DESTINATION_TESTED`.
- **[v0.6, SPEC-802]** Un `endpoint` de loopback, link-local o metadatos de nube (`169.254.169.254`) → `422 DESTINATION_ENDPOINT_NOT_ALLOWED`, sin conectarse. Un rango privado solo se admite con `DESTINATION_ALLOW_PRIVATE=true`. Un host que no resuelve por DNS también responde `422 DESTINATION_ENDPOINT_NOT_ALLOWED`. La validación se repite antes de cada prueba (SPEC-802 T3).
- **[v0.6, SPEC-803]** `GET /organizations/storage-policy` (cualquier miembro) → `200 { "model", "defaultDestinationId", "destinations": [{ "id", "name", "location" }] }`. `model` es `cloud`, `on_premises` o `hybrid`. `destinations` lista solo los destinos habilitados y `Conectado`, sin endpoint ni credenciales. `defaultDestinationId` es `null` si el predeterminado no está disponible.
- **[v0.6, SPEC-803]** `PUT /organizations/storage-policy` con `{ "model", "defaultDestinationId" }` (solo `tenant_admin`) → `200` con la forma de `GET`. En una sola transacción cambia el modelo y el predeterminado (quitando antes la marca anterior) y repunta las carpetas raíz de los Drives de la organización. Las versiones existentes y las subcarpetas no cambian. Errores: `422 DEPLOYMENT_MODEL_REQUIREMENTS_UNMET` si falta un destino conectado de la ubicación que exige el modelo (en `hybrid`, uno de cada ubicación) o si el predeterminado no corresponde a la ubicación del modelo; `422 DESTINATION_NOT_AVAILABLE` si el predeterminado es ajeno, está deshabilitado o no está `Conectado`. Emite `DEPLOYMENT_MODEL_CHANGED`.
- **[v0.6, SPEC-803]** `POST /organizations/installation-requests` con `{ "requestedModel" }` (solo `tenant_admin`) → `201 { "id", "status": "Pendiente", "createdAt" }`. Si la organización ya tiene una solicitud `Pendiente` → `409 INSTALLATION_REQUEST_PENDING`. Emite `INSTALLATION_REQUESTED`. La solicitud no es requisito para elegir el modelo.
- **[v0.6, SPEC-803]** `GET /organizations/installation-requests` (solo `tenant_admin`) → `{ "items": [{ "id", "requestedModel", "status", "createdAt", "reviewedAt" }] }`, de la más reciente a la más antigua.
- **[v0.6, SPEC-803]** `POST /folders` acepta `destinationId?` (UUID). Solo una carpeta principal en `hybrid` puede elegirlo; en cualquier otro caso, incluida una subcarpeta, responde `422 DESTINATION_SELECTION_NOT_ALLOWED`. Sin `destinationId`, la carpeta principal usa el predeterminado y la subcarpeta hereda el destino de su padre. Un `destinationId` que no está disponible → `422 DESTINATION_NOT_AVAILABLE`. La respuesta añade `destinationId` y `destinationLocation` (`cloud` u `on_premises`). Campos no declarados → `400`.
- **[v0.6, SPEC-803]** `GET /folders` y `GET /folders/:id/items` añaden `destinationLocation` a cada carpeta: `cloud`, `on_premises` o `null` si la carpeta no tiene destino.
- **[v0.6, SPEC-220]** `POST /teams` con `{ "name" }` (se recorta; 1 a 150 caracteres) → `201 { "id", "name", "driveId", "createdAt" }`. En una sola transacción crea el equipo, su Drive de tipo `team` y la carpeta raíz `Archivos`. Nombre repetido en la organización sin distinguir mayúsculas → `409 TEAM_NAME_CONFLICT`. Solo `tenant_admin`. Emite `TEAM_CREATED`.
- **[v0.6, SPEC-220]** `GET /teams` → `{ "items": [{ "id", "name", "driveId", "memberCount", "myLevel" }] }`, ordenado por nombre. `tenant_admin` ve todos los equipos de su organización; un colaborador solo aquellos a los que pertenece. `memberCount` cuenta solo miembros con membresía activa en la organización. `myLevel` es `write` para todo `tenant_admin`, sea o no miembro; para los demás, el nivel de su fila (`read` o `write`).
- **[v0.6, SPEC-220]** `GET /teams/:id/members` → `{ "items": [{ "userId", "fullName", "email", "level", "joinedAt" }] }`. Solo miembros con membresía activa; los suspendidos o eliminados no aparecen. Solo `tenant_admin`. Equipo ajeno, de otra organización o inexistente → `404`.
- **[v0.6, SPEC-220]** `POST /teams/:id/members` con `{ "userId", "level": "read" | "write" }` → `201` sin cuerpo. La persona debe tener membresía activa en la organización (`422 USER_NOT_IN_ORGANIZATION`) y no estar ya en el equipo (`409 TEAM_MEMBER_EXISTS`, sin cambiar su nivel). Emite `TEAM_MEMBER_ADDED`.
- **[v0.6, SPEC-220]** `PATCH /teams/:id/members/:userId` con `{ "level" }` → `200` sin cuerpo. Si el nivel ya es el pedido, responde sin escribir ni auditar. Miembro que no pertenece al equipo → `404`. Emite `TEAM_MEMBER_LEVEL_CHANGED`.
- **[v0.6, SPEC-220]** `DELETE /teams/:id/members/:userId` → `204`. Miembro que no pertenece al equipo → `404`. Emite `TEAM_MEMBER_REMOVED`.
- **[v0.6, SPEC-220]** En todas las rutas de equipos: `id` o `userId` que no son UUID → `400`; campos no declarados (p. ej. `organizationId`) → `400`; un colaborador en una ruta de administración → `403 FORBIDDEN_ROLE`; equipo de otra organización o inexistente → `404`. Los eventos de auditoría de equipos llevan `resource_type = team` y el id del equipo, sin nombre de equipo ni datos personales. No hay ruta para eliminar equipos: queda fuera de este corte.
- **[v0.6, SPEC-114]** `POST /organizations/close` (solo `tenant_admin`; cuerpo `{ "organizationName", "password" }`) → `200 { "closed": true }` y limpia la cookie de refresco. Valida la contraseña antes de la transacción; en una sola transacción pone la organización en `cancelled`, cancela su suscripción activa y revoca las sesiones de todos sus miembros. Archivos, versiones y carpetas se conservan. Errores: `401 INVALID_CREDENTIALS` (contraseña incorrecta), `422 ORGANIZATION_NAME_MISMATCH` (nombre distinto tras recortar espacios; comparación exacta), `403 FORBIDDEN_ROLE` (colaborador). Después del cierre, `POST /auth/login` con contraseña correcta responde `403 NO_ACTIVE_MEMBERSHIP` y las solicitudes con sesión previa responden `401`. Emite `ORGANIZATION_CLOSED` tras el commit; si la auditoría falla se registra en log y no revierte el cierre.

## Implementación y cambios futuros

- IAM implementa identidad, cookies, refresh y el contexto autenticado; Billing implementa catálogo y persistencia de suscripción; Files implementa objetos, versiones, uso y reservas; Víctor implementa Dashboard, coordinador de activación y frontend.
- Las migraciones compartidas se consolidan en una sola ubicación y se presentan en un solo PR integrador, según `CONTRIBUTING.md`.
- La ubicación canónica es `database/migrations/` en la raíz del repositorio. Los PR de dominio entregan sus cambios de esquema al integrador; no dupliquen la misma migración en `apps/db/database/migrations/`.
- MFA/TOTP queda fuera del alcance actual. **[v0.5]** Recuperación de contraseña y RBAC entran en el corte del 80% según las secciones marcadas **[v0.5]**.
