# Files

Files implementa el Drive personal, carpetas, archivos versionados y su uso de almacenamiento. Sus entidades apuntan al esquema canónico `files.*` creado en `database/migrations/`; no usa tablas paralelas en `public`.

## Integración con IAM

El hook requerido `personal-drive` recibe el mismo `EntityManager` de la transacción de registro de IAM. En esa transacción provisiona `Mi espacio`, la raíz `Archivos`, la fila de cuota, el destino S3 y la referencia de la KEK del tenant. Si falla una de esas escrituras, IAM revierte todo el registro. El hook solo escribe metadatos en PostgreSQL.

## Integración con Billing

Files lee el límite vigente mediante `BillingService`. Antes de aceptar una carga, bloquea `files.tenant_quota` con `SELECT ... FOR UPDATE`, suma versiones retenidas y reservas activas, y registra una reserva durable. El coordinador de suscripciones pasa su `EntityManager` a `getTotalStorageUsage`, por lo que un downgrade y una reserva concurrente se serializan sobre la misma fila. Sin suscripción, el límite es cero.

El uso confirmado cuenta `files.file_version.size_bytes` una vez por versión; no suma un contador duplicado de `files.file`. Los archivos en papelera cuentan durante 30 días; con SPEC-215 cuentan hasta su eliminación física (ADR-008 §9). Las reservas se liberan al confirmar o fallar la carga y también se consideran en los cambios de plan.

## Cifrado y Storage

Cada versión usa una DEK aleatoria y AES-256-GCM. La DEK se protege con una KEK derivada por tenant mediante HKDF-SHA256; PostgreSQL guarda solo la DEK cifrada y una referencia externa a `FILES_MASTER_KEY`. El objeto contiene ciphertext, nonce y tag; `checksum` guarda SHA-256 del contenido original. `FilesCryptoService` valida el tag y el checksum al descargar.

Configura `FILES_MASTER_KEY` como una llave aleatoria de 32 bytes en base64, entregada por el gestor de secretos del entorno. No la guardes en PostgreSQL ni la reutilices como `JWT_SECRET`. La rotación de la llave maestra debe conservar acceso a las versiones anteriores antes de reemplazar el secreto.

El navegador se comunica únicamente con la API Nexus. `StorageRouter` (SPEC-801) entrega el almacén S3 de cada destino (SeaweedFS hoy); los nombres originales nunca forman parte de `object_key` y las credenciales del proveedor no se devuelven a la API.

## Control de acceso a Drives (SPEC-221)

`DriveAccessService` decide qué Drive puede usar cada miembro y en qué nivel. Es el único punto de Files que busca Drives para autorizar una operación; `FilesService` ya no consulta `drive_id` por su cuenta.

- `findDrive(actor)` devuelve el Drive personal del solicitante con nivel `owner`. No crea nada: la creación sigue en `getOrCreateUserDrive` y `ensureUserDrive`.
- `requireFolder(actor, folderId)` devuelve una carpeta activa de un Drive accesible; si no existe, pertenece a otro Drive u otra organización, responde 404 sin revelar que existe.
- `locateFile(actor, fileId)` localiza un archivo de un Drive accesible en cualquier estado de papelera, y devuelve `null` si no es accesible.

Todas las búsquedas filtran por organización y propietario. Los Drives de equipo y sus niveles `read`/`write` llegarán con SPEC-220 a 224.

## Historial de versiones (SPEC-206)

`GET /files/:id/versions` lista las versiones de un archivo del Drive personal del solicitante, de la más reciente a la más antigua. Solo considera archivos activos; los ajenos, de otra organización, inexistentes o en papelera responden 404. La respuesta no incluye `object_key`, `encrypted_dek`, `kek_id` ni `checksum`. Es solo lectura: la descarga y la restauración de versiones están en SPEC-210.

## Descarga y restauración de versiones (SPEC-210)

`GET /files/:id/versions/:versionId/download` entrega los bytes exactos de cualquier versión del archivo, aunque no sea la vigente, con el nombre seguro del archivo. `POST /files/:id/versions/:versionId/restore` crea una versión nueva con ese contenido, que pasa a ser la vigente; las anteriores se conservan. `FileVersionsService` concentra ambas operaciones y el historial de SPEC-206. Restaurar reutiliza `FilesService.uploadMultipartFile`, así que aplica la misma cuota, cifrado, compensación y límite de cargas simultáneas. Errores: 404 para archivo ajeno, de otra organización, inexistente, en papelera o versión de otro archivo; 422 `VERSION_ALREADY_CURRENT`; 422 `STORAGE_QUOTA_EXCEEDED`; 400 si `versionId` no es un UUID. Auditoría: `FILE_DOWNLOAD` al bajar; `FILE_UPLOAD` y `FILE_VERSION_RESTORED` al restaurar, con el mismo `correlationId`.

`readVersionBytes` lee y descifra una versión; SPEC-216 la reutiliza para enlaces públicos.

## Alcance actual

- Solo se expone el Drive personal del usuario autenticado; cada búsqueda valida organización y `drive_id` derivado del JWT.
- La subida multipart se mantiene en memoria hasta el máximo contractual de 100,000,000 bytes.
- Los tipos admitidos son PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT y ZIP; se valida la firma del contenido además de extensión y MIME.
- Las claves de idempotencia se guardan en `files.upload` con alcance de organización y restricción única.
