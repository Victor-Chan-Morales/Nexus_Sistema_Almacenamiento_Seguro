# Módulo Files

**Dueño:** Miguel.

## Responsabilidades
- Creación y listado de carpetas jerárquicas con aislamiento multi-tenant.
- Registro de metadatos de archivos con soporte de múltiples versiones (`FileVersion`).
- Control de cuota y tamaño acumulado por organización.
- Generación de URLs prefirmadas seguras para descarga de objetos.
- Eliminación lógica (soft-delete).

## Comunicación en el Monolito Modular
`FilesModule` consume directamente mediante inyección de dependencias:
- `BillingService`: para validar que la subida no supere la cuota de la organización.
- `StorageService`: para enviar el flujo binario al repositorio SeaweedFS (S3).
Todo se realiza dentro del mismo proceso sin llamadas HTTP ni endpoints de red intermedios.
