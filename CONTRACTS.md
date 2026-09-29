# Contratos compartidos de API y frontend

> **Estado: APROBADO v0.2 para el primer flujo.** Es una traducción del recorrido acordado; no afirma que todos los endpoints ya estén implementados. Toda respuesta que aparezca en una página provisional debe llevar datos de maqueta claramente identificados hasta que API esté conectada.

## Convenciones

- Content-Type: JSON; carga de archivos usa `multipart/form-data`.
- La web accede a API con `NEXT_PUBLIC_API_BASE_URL` (solo URL pública, sin credenciales).
- Sesión propuesta: `Authorization: Bearer <accessToken>`. El token no se guarda en logs; estrategia de almacenamiento y refresh se debe aprobar en IAM.
- Organización: jamás aceptar `organizationId` del navegador como prueba de alcance. `GET /plans` puede ser lectura pública; contratar requiere sesión. API deriva el tenant de IAM/membresía.
- Identificadores UUID. Fechas ISO-8601 UTC.
- Error común: `{ "code": "ERROR_CODE", "message": "Mensaje seguro", "requestId": "uuid" }`. No incluir stack trace, secreto o datos de otro tenant.
- Los nombres y rutas actuales corresponden al plan del 30%. Prefijo/versionado nuevo requiere aprobación documentada.

## Recorrido de 30%

| Módulo | Método y ruta | Entrada propuesta | Salida propuesta | Propietario API |
|---|---|---|---|---|
| IAM | `POST /auth/register` | `{ fullName, email, password, organizationName }` | `{ userId, organizationId, role, verificationRequired }` | Sebastián |
| IAM | `POST /auth/login` | `{ email, password }` | `{ accessToken, expiresAt, user: { id, fullName, email }, organization: { id, name }, role }` | Sebastián |
| IAM | `GET /auth/me` | Bearer token | `{ user, organization, role }` | Sebastián |
| Billing | `GET /plans` | Bearer token | `{ items: [{ id, name, description, priceMonthly, storageLimitBytes, userLimit, validityDays }] }` | Anthony |
| Billing | `POST /subscriptions/activate` | `{ planId }` | `{ subscriptionId, status: "active", simulated: true, startDate, endDate }` | Anthony |
| Dashboard | `GET /dashboard` | Bearer token | `{ organizationName, plan, storageUsedBytes, storageLimitBytes, recentActivity }` | Integración; origen por módulo |
| Files | `GET /folders` | Bearer token | `{ items: [{ id, name, parentFolderId, driveId }] }` | Miguel |
| Files | `POST /folders` | `{ name, parentFolderId? }` | `{ id, name, parentFolderId, driveId, createdAt }` | Miguel |
| Files | `GET /folders/:id/items` | Bearer token | `{ folders: [], files: [] }` | Miguel |
| Files | `POST /files/upload` | `folderId`, `file`, opcional `Idempotency-Key` | `{ id, name, mimeType, sizeBytes, versionId, uploadedAt }` | Miguel |
| Files | `GET /files/:id/download` | Bearer token | Bytes + `Content-Disposition` seguro | Miguel |

## Reglas HTTP

- `400`: datos ausentes o mal formados; `401`: no autenticado; `403`: rol o estado no habilita; `404`: recurso inexistente o fuera del alcance sin revelar su existencia; `409`: conflicto (correo duplicado, suscripción activa, etc.); `413`: archivo demasiado grande; `415`: tipo no permitido; `422`: regla de negocio no satisfecha; `429`: límites de intentos/carga; `500`: falla inesperada con mensaje genérico.
- Errores de organización ajena no deben confirmar que el UUID existe.
- Una solicitud de carga solo responde éxito después de que el objeto y sus metadatos estén confirmados.
- La activación de plan es siempre `simulated: true`; no ejecutar ni pedir datos de tarjeta.

## Decisiones operativas del contrato

1. La verificación se realizará mediante `EmailService`; el token vence en 15 minutos y se usa una sola vez.
2. La sesión usa refresh token en cookie `HttpOnly`; no se persisten tokens en `localStorage`.
3. El límite inicial por archivo es 100 MB; el plan demo tiene 5 GB y 5 usuarios.
4. El registro crea el Drive personal `Mi espacio` y la carpeta raíz `Archivos`.
5. El cambio de plan se valida mediante `PLAN_REVISION`; una reducción no se acepta si el uso excede el nuevo límite.
6. Los estados visuales definitivos se cotejan con Figma, sin cambiar las reglas de API aprobadas.

## Requisitos de identidad no implementados por este contrato del 30%

El curso y la propuesta requieren verificación de correo, recuperación de contraseña, sesiones seguras y RBAC completo. MFA/TOTP queda fuera del alcance actual. Este contrato cubre el flujo aprobado; los endpoints posteriores deben conservar estas reglas y documentarse antes de implementarse.
