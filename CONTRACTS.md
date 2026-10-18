# Contratos compartidos de API e integración

> **Versión 0.3 — aprobada para implementación por Víctor, integrador, el 2026-10-18.** Esta versión fija las interfaces que deben seguir las PR de IAM, Billing, Files y frontend. Si una implementación necesita cambiar una ruta, campo o regla, primero se actualiza este documento y `SESSION_LOG.md`.

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

## IAM y sesión

- El access token dura **15 minutos** y se guarda solo en memoria. Su `expiresAt` corresponde a esa expiración.
- El refresh token dura **7 días**, se persiste en servidor únicamente como hash y se entrega en una cookie llamada `nexus_refresh` con `HttpOnly`, `SameSite=Lax`, `Path=/api/auth` y `Secure` en producción.
- Cada refresh rota la cookie. Logout revoca la sesión asociada a esa cookie y responde `204`.
- Login y refresh devuelven el mismo formato de sesión: access token, expiración, usuario, organización activa y rol.
- `POST /auth/verify-email` recibe `{ token }`. El enlace del correo debe abrir `/verificar-correo?token=...`; el token vence en 15 minutos y solo se usa una vez.
- El registro agrega en la misma transacción un mensaje de salida para enviar el correo de verificación. El envío SMTP ocurre después del commit y se reintenta desde una cola/outbox persistente si el proveedor falla; no se revierte una cuenta ya creada por una falla temporal de correo ni se devuelve el token al navegador. No hay endpoint de reenvío manual en este corte.
- El guard JWT valida usuario y membresía, y entrega a controladores `req.user = { userId, email, organizationId, organizationName, role }`. `organizationName` corresponde a la membresía activa validada. Refresh conserva esa organización y comprueba que la membresía siga activa; nunca selecciona otra silenciosamente.
- El cliente web usa `credentials: "include"`. CORS acepta el origen explícito configurado en `WEB_URL`, permite credenciales y expone `Content-Disposition`.
- El registro crea usuario, organización, membresía, suscripción Demo, cuota, Drive `Mi espacio` y carpeta raíz `Archivos` en una sola transacción. Los hooks de Billing y Files usan el mismo `EntityManager`, escriben metadatos en PostgreSQL y no llaman a SeaweedFS. Si un hook falla, se revierte el registro completo.

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

## Implementación y cambios futuros

- IAM implementa identidad, cookies, refresh y el contexto autenticado; Billing implementa catálogo y persistencia de suscripción; Files implementa objetos, versiones, uso y reservas; Víctor implementa Dashboard, coordinador de activación y frontend.
- Las migraciones compartidas se consolidan en una sola ubicación y se presentan en un solo PR integrador, según `CONTRIBUTING.md`.
- La ubicación canónica es `database/migrations/` en la raíz del repositorio. Los PR de dominio entregan sus cambios de esquema al integrador; no dupliquen la misma migración en `apps/db/database/migrations/`.
- MFA/TOTP queda fuera del alcance actual. Recuperación de contraseña y RBAC completo son trabajo posterior; no se deben presentar como parte de este primer flujo.
