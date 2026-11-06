# Módulo Storage

**Dueño:** Miguel.

## Responsabilidades
- Almacenamiento de objetos con SeaweedFS (S3), detrás de una interfaz por destino (SPEC-801).
- `ObjectStorage` (`object-storage.ts`): `put`, `get` y `delete`. `S3ObjectStorage` la implementa sobre un bucket S3.
- `StorageRouter` (`storage-router.service.ts`): entrega el `ObjectStorage` del `destination_id` de cada operación.
  - Lectura y borrado (`forRead`) admiten destinos deshabilitados.
  - Escritura (`forWrite`) exige un destino habilitado; si no, responde 409.
  - Un destino de otra organización o inexistente responde 404 sin tocar el almacén.
  - Un destino con credenciales propias (SPEC-802) usa un `S3ObjectStorage` sobre su propio cliente S3. El cliente se cachea por destino y se reconstruye si cambia su configuración cifrada; `invalidate` lo descarta al editarlo.
  - `probe` (SPEC-802): escribe, lee, compara y borra un objeto `.nexus-connection-test/<uuid>` con límite de 10 s. Devuelve solo una causa segura: `AUTH`, `NETWORK`, `BUCKET_NOT_FOUND` o `DATA_MISMATCH`. Un destino de entorno se prueba con el cliente `S3_CLIENT`.
- `StorageService`: destino de entorno (`S3_*`). Es el almacén de los destinos cuyas credenciales son referencias `environment:*`.
- Aislamiento multi-tenant a nivel de object-key (`<organizationId>/<fileId>/v<version>/<uuid>`).

## Comunicación en el Monolito Modular
Exporta `StorageRouter`. `FilesService` lo inyecta y pide el almacén con el `destination_id` de cada versión o carpeta. Ningún módulo fuera de Storage importa `StorageService` ni `@aws-sdk`.
