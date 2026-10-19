# Files

Files implementa el Drive personal, carpetas, archivos versionados y su uso de almacenamiento. Sus entidades apuntan al esquema canónico `files.*` creado en `database/migrations/`; no usa tablas paralelas en `public`.

## Integración con IAM

El hook requerido `personal-drive` recibe el mismo `EntityManager` de la transacción de registro de IAM. En esa transacción provisiona `Mi espacio`, la raíz `Archivos`, la fila de cuota, el destino S3 y la referencia de la KEK del tenant. Si falla una de esas escrituras, IAM revierte todo el registro. El hook solo escribe metadatos en PostgreSQL.

## Integración con Billing

Files lee el límite vigente mediante `BillingService`. Antes de aceptar una carga, bloquea `files.tenant_quota` con `SELECT ... FOR UPDATE`, suma versiones retenidas y reservas activas, y registra una reserva durable. El coordinador de suscripciones pasa su `EntityManager` a `getTotalStorageUsage`, por lo que un downgrade y una reserva concurrente se serializan sobre la misma fila. Sin suscripción, el límite es cero.

El uso confirmado cuenta `files.file_version.size_bytes` una vez por versión; no suma un contador duplicado de `files.file`. Los archivos en papelera cuentan durante 30 días. Las reservas se liberan al confirmar o fallar la carga y también se consideran en los cambios de plan.

## Cifrado y Storage

Cada versión usa una DEK aleatoria y AES-256-GCM. La DEK se protege con una KEK derivada por tenant mediante HKDF-SHA256; PostgreSQL guarda solo la DEK cifrada y una referencia externa a `FILES_MASTER_KEY`. El objeto contiene ciphertext, nonce y tag; `checksum` guarda SHA-256 del contenido original. `FilesCryptoService` valida el tag y el checksum al descargar.

Configura `FILES_MASTER_KEY` como una llave aleatoria de 32 bytes en base64, entregada por el gestor de secretos del entorno. No la guardes en PostgreSQL ni la reutilices como `JWT_SECRET`. La rotación de la llave maestra debe conservar acceso a las versiones anteriores antes de reemplazar el secreto.

El navegador se comunica únicamente con la API Nexus. `StorageService` encapsula SeaweedFS/S3; los nombres originales nunca forman parte de `object_key` y las credenciales del proveedor no se devuelven a la API.

## Alcance actual

- Solo se expone el Drive personal del usuario autenticado; cada búsqueda valida organización y `drive_id` derivado del JWT.
- La subida multipart se mantiene en memoria hasta el máximo contractual de 100,000,000 bytes.
- Los tipos admitidos son PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT y ZIP; se valida la firma del contenido además de extensión y MIME.
- Las claves de idempotencia se guardan en `files.upload` con alcance de organización y restricción única.
