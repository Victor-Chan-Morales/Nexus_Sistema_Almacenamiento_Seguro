# Contratos compartidos de API y frontend

> **Estado: PROPUESTO v0.2 — requiere revisión del equipo antes de implementarse.** Es una traducción inicial del recorrido acordado en el plan del 30%; no afirma que existan endpoints. Toda respuesta que aparezca en una página provisional debe llevar datos de maqueta claramente identificados hasta que API esté conectada.

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

## Contratos que deben decidirse antes de integrar

1. ¿Correo debe verificarse antes de iniciar sesión? El requisito final exige verificación; para demo local se necesita un flujo reproducible sin correo real.
2. ¿La sesión se guarda en cookie httpOnly o en otro mecanismo? Sebastián define y Víctor lo consume; no persistir tokens sensibles en `localStorage` por conveniencia.
3. Tamaño máximo/tipos de archivo permitidos por planes.
4. Nombre y estado inicial del drive de demostración (el diccionario soporta personal y de equipo).
5. Si cambiar de plan con suscripción vigente se bloquea o se tramita una revisión.
6. Qué estados exactos muestra Figma y qué endpoints alimentan Dashboard.

## Reconciliación pendiente con el diagrama de clases

La versión v0.2 registra aclaraciones para revisión; el contrato sigue **propuesto** y no se considera aprobado por la actualización del diagrama. El informe de comparación está en `docs/revision-diagrama-clases.md`.

- La API presenta storageLimitBytes en bytes. El diccionario persiste storage_limit_gb; Billing debe convertir de forma determinista antes de responder y nunca mezclar unidades.
- El contrato incluye userLimit, pero la clase Plan del SVG no lo muestra. Mantenerlo en la respuesta propuesta hasta que el equipo corrija el diagrama o apruebe otra decisión.
- description y validityDays aparecen en la salida de catálogo propuesta, pero no están en la tabla PLAN del diccionario. No inventar columnas: aprobar la actualización del diccionario o ajustar el contrato antes de implementarlo.
- La respuesta de carga debe informar sizeBytes real y uploadedAt. El modelo persistente FILE_VERSION debe incluir size_bytes, uploaded_by y uploaded_at según diccionario; cualquier nueva respuesta HTTP se acuerda con Files y Víctor antes de implementarla.
- Los cambios de asociación Usuario–Membresía, Usuario–Sesión, Organización–Instalación, Carpeta/Versión–Destino y versión–llave son cambios de modelo interno. No cambian rutas HTTP automáticamente; actualizar este contrato solo si un consumidor externo necesita nuevos datos.
- AuthService, BillingService e InstallationService son propuestas de organización interna. DatabaseServiceClient no se convierte en un endpoint ni en dependencia compartida de todos los módulos sin una decisión arquitectónica.

## Requisitos de identidad no implementados por este contrato del 30%

El curso y la propuesta requieren verificación de correo, recuperación de contraseña, sesiones seguras, MFA/TOTP y RBAC completo. Este primer contrato cubre solo lo mínimo que se decida para el flujo demostrable. Los demás endpoints deben diseñarse y aprobarse antes de su implementación, no simularse como ya terminados.
