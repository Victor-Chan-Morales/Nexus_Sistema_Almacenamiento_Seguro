# Módulo Storage

**Dueño:** Miguel.

## Responsabilidades
- Almacenamiento de objetos con SeaweedFS (S3), detrás de una interfaz por destino (SPEC-801).
- `ObjectStorage` (`object-storage.ts`): `put`, `get` y `delete`. `S3ObjectStorage` la implementa sobre un bucket S3.
- `StorageRouter` (`storage-router.service.ts`): entrega el `ObjectStorage` del `destination_id` de cada operación.
  - Lectura y borrado (`forRead`) admiten destinos deshabilitados.
  - Escritura (`forWrite`) exige un destino habilitado; si no, responde 409.
  - Un destino de otra organización o inexistente responde 404 sin tocar el almacén.
- `StorageService`: destino de entorno (`S3_*`). Hoy es el único almacén que devuelve el router. SPEC-802 añadirá los destinos con credenciales propias.
- Aislamiento multi-tenant a nivel de object-key (`<organizationId>/<fileId>/v<version>/<uuid>`).

## Comunicación en el Monolito Modular
Exporta `StorageRouter`. `FilesService` lo inyecta y pide el almacén con el `destination_id` de cada versión o carpeta. Ningún módulo fuera de Storage importa `StorageService` ni `@aws-sdk`.
