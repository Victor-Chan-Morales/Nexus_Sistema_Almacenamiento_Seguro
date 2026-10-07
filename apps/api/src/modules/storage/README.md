# Módulo Storage

**Dueño:** Miguel.

## Responsabilidades
- Implementación de la estrategia de almacenamiento de objetos con MinIO/S3.
- Métodos de transporte de binarios: `put`, `get`, `delete`, `getPresignedUrl`.
- Aislamiento multi-tenant a nivel de object-key (`<organizationId>/<fileId>/v<version>`).

## Comunicación en el Monolito Modular
Exporta `StorageService`. Es inyectado directamente en `FilesService`, garantizando que la lógica de negocio de archivos no dependa de APIs de red intermedias para guardar objetos.
