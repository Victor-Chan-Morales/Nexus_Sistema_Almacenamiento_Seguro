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

## Destinos propios (SPEC-802)

`DestinationsService` administra los destinos de almacenamiento de la organización: `POST /destinations`, `GET /destinations`, `PATCH /destinations/:id` y `POST /destinations/:id/test`. Todas las rutas son solo para `tenant_admin`.

- Las credenciales (`accessKey`, `secretKey`) se cifran con la llave maestra y se descifran solo dentro de `StorageRouter`. Ninguna respuesta, log ni evento de auditoría las incluye.
- Antes de conectarse, el endpoint se valida contra loopback, link-local, metadatos de nube y, salvo con `DESTINATION_ALLOW_PRIVATE=true`, rangos privados. La validación resuelve DNS y se repite en cada prueba.
- Deshabilitar el destino predeterminado o uno con carpetas activas responde `422 DESTINATION_IN_USE`.
- Los destinos de entorno (`S3_*`) aparecen en el listado sin `endpoint` ni `region`, y no se pueden reemplazar desde la API.

## Destino de carpetas según el modelo (SPEC-803)

- `FolderPlacementService` decide el destino de una carpeta nueva. Las subcarpetas heredan el de su padre y no admiten `destinationId`. Una carpeta principal usa una estrategia por modelo (`ROOT_PLACEMENT_BY_MODEL`): en `cloud` y `on_premises` usa el predeterminado; en `hybrid` acepta un destino disponible. Añadir un modelo es una estrategia nueva (OCP).
- `DestinationDefaults` concentra las consultas de destinos disponibles y el cambio del predeterminado. El cambio quita primero la marca anterior (índice parcial único) y repunta las carpetas raíz de todos los Drives. Recibe el `EntityManager` del llamador.
- Files no importa IAM: lee el modelo por el puerto `DeploymentModelSource`, enlazado en `FilesModule` a `OrganizationRepository`.
- `GET /folders` y `GET /folders/:id/items` añaden `destinationLocation` (`cloud`, `on_premises` o `null`) con una sola consulta.

## Control de acceso a Drives (SPEC-221)

`DriveAccessService` decide qué Drive puede usar cada miembro y en qué nivel. Es el único punto de Files que busca Drives para autorizar una operación; `FilesService` ya no consulta `drive_id` por su cuenta.

- `findDrive(actor)` devuelve el Drive personal del solicitante con nivel `owner`. No crea nada: la creación sigue en `getOrCreateUserDrive` y `ensureUserDrive`.
- `requireFolder(actor, folderId)` devuelve una carpeta activa de un Drive accesible; si no existe, pertenece a otro Drive u otra organización, responde 404 sin revelar que existe.
- `locateFile(actor, fileId)` localiza un archivo de un Drive accesible en cualquier estado de papelera, y devuelve `null` si no es accesible.

Todas las búsquedas filtran por organización y propietario. Los Drives de equipo ya existen desde SPEC-220 (ver abajo); su acceso por nivel `read`/`write` para operar archivos llega con SPEC-222 y SPEC-224.

## Historial de versiones (SPEC-206)

`GET /files/:id/versions` lista las versiones de un archivo del Drive personal del solicitante, de la más reciente a la más antigua. Solo considera archivos activos; los ajenos, de otra organización, inexistentes o en papelera responden 404. La respuesta no incluye `object_key`, `encrypted_dek`, `kek_id` ni `checksum`. Es solo lectura: la descarga y la restauración de versiones están en SPEC-210.

## Descarga y restauración de versiones (SPEC-210)

`GET /files/:id/versions/:versionId/download` entrega los bytes exactos de cualquier versión del archivo, aunque no sea la vigente, con el nombre seguro del archivo. `POST /files/:id/versions/:versionId/restore` crea una versión nueva con ese contenido, que pasa a ser la vigente; las anteriores se conservan. `FileVersionsService` concentra ambas operaciones y el historial de SPEC-206. Restaurar reutiliza `FilesService.uploadMultipartFile`, así que aplica la misma cuota, cifrado, compensación y límite de cargas simultáneas. Errores: 404 para archivo ajeno, de otra organización, inexistente, en papelera o versión de otro archivo; 422 `VERSION_ALREADY_CURRENT` si la versión ya es la vigente o tiene el mismo contenido; 422 `STORAGE_QUOTA_EXCEEDED`; 400 si `id` o `versionId` no son UUID. Restaurar usa `FilesService.uploadMultipartFileWithVersion` con `restore`: bloquea el archivo por id dentro de la transacción, así que no busca por nombre y no crea un archivo nuevo si el original fue a la papelera. Auditoría: `FILE_DOWNLOAD` al bajar; `FILE_UPLOAD` y `FILE_VERSION_RESTORED` al restaurar, con el mismo `correlationId`.

`readVersionBytes` lee y descifra una versión; SPEC-216 la reutiliza para enlaces públicos.

## Enlaces compartidos (SPEC-209)

`ShareLinksService` crea, lista y revoca enlaces temporales a la versión vigente de un archivo. `POST /files/:id/share-links` genera un token de 256 bits y lo devuelve en claro una sola vez; la base guarda solo su hash SHA-256. La contraseña opcional se guarda con Argon2id y tiene política propia (8 a 128 caracteres), no la de la cuenta. El estado (`active`, `expired`, `revoked`) se calcula al leer con `shareLinkStatus`, función pura que SPEC-216 reutiliza. Revocar es idempotente y funciona aunque el archivo esté en papelera. Crear, listar y revocar exigen nivel `write` u `owner`; con otro nivel responden 404. Auditoría: `SHARE_LINK_CREATED` y `SHARE_LINK_REVOKED`, sin token ni contraseña. El acceso público por el token es SPEC-216.

## Equipos y miembros (SPEC-220)

`TeamsService` crea equipos y administra sus miembros. `POST /teams` crea en una sola transacción el equipo, su Drive de tipo `team` y la carpeta raíz `Archivos`, con el destino predeterminado del tenant (`FilesService.ensureTenantResources`, ahora pública). Cada miembro (`files.team_member`) tiene nivel `read` o `write`. Agregar un miembro exige membresía activa en la organización, validada con `MemberAdmission.isActiveMember` (IAM); Files no lee tablas de IAM. Un duplicado responde `409 TEAM_MEMBER_EXISTS` sin cambiar el nivel existente: el servicio usa `insert`, no `save`. El nombre del equipo es único por organización sin distinguir mayúsculas; la restricción de la base decide, y el servicio la traduce a `409 TEAM_NAME_CONFLICT`.

`myLevel` en `GET /teams` es `write` para todo `tenant_admin` y el nivel de la fila para los demás; `teamLevelOf` implementa la regla y SPEC-222 la reutiliza. `memberCount` cuenta solo miembros activos. La administración exige `tenant_admin` mediante `RolesGuard`; `GET /teams` lo puede usar cualquier miembro. Auditoría: `TEAM_CREATED`, `TEAM_MEMBER_ADDED`, `TEAM_MEMBER_LEVEL_CHANGED` y `TEAM_MEMBER_REMOVED`, todas con `resource_type = team`. Eliminar equipos queda fuera.

## Alcance actual

- Solo se expone el Drive personal del usuario autenticado; cada búsqueda valida organización y `drive_id` derivado del JWT.
- La subida multipart se mantiene en memoria hasta el máximo contractual de 100,000,000 bytes.
- Los tipos admitidos son PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT y ZIP; se valida la firma del contenido además de extensión y MIME.
- Las claves de idempotencia se guardan en `files.upload` con alcance de organización y restricción única.

## Purga automática (SPEC-215)

Las versiones en papelera cuentan para la cuota hasta la purga. La tarea revisa primero carpetas raíz de la papelera y luego archivos, en lotes de 50, solo en organizaciones activas. La retención es de 30 días y el intervalo se configura con TRASH_PURGE_INTERVAL_MS (una hora por defecto). Una transacción por elemento revalida el plazo, protege contra ejecuciones simultáneas y actualiza la cuota. Tras el commit se eliminan los objetos y se registra la purga con actor system.
