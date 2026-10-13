# ADR-004: SeaweedFS como almacenamiento de objetos local

- **Estado:** Aprobada
- **Fecha:** 2026-10-08
- **Reemplaza para el entorno local:** la decisión de usar MinIO documentada en ADR-001

## Contexto

La imagen de MinIO referenciada por Compose dejó de estar disponible de forma anónima en los registros probados. El backend necesita almacenamiento de objetos con operaciones compatibles con S3: crear bucket, cargar, leer y eliminar objetos, y emitir URLs prefirmadas.

## Decisión

- Usar SeaweedFS en Docker Compose para el entorno local, con su gateway S3 escuchando en el puerto `8333`.
- Usar AWS SDK for JavaScript v3 desde `StorageModule`, sin acoplar la lógica de Files al proveedor.
- Mantener PostgreSQL como almacén de metadatos y SeaweedFS como almacén de bytes.
- Publicar el endpoint S3 en `localhost:8333` para URLs prefirmadas consumidas por el navegador; dentro de Compose la API usa el host `seaweedfs`.
- Crear el bucket configurado al inicializar el módulo Storage.

## Configuración

Las variables se documentan en `.env.example`: `S3_ENDPOINT`, `S3_PORT`, `S3_PUBLIC_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FILER_SIGNING_KEY`, `S3_BUCKET`, `S3_REGION` y `S3_USE_SSL`. SeaweedFS recibe `S3_FILER_SIGNING_KEY` como `WEED_JWT_FILER_SIGNING_KEY` para firmar sus operaciones internas de IAM.

## Consecuencias

- El equipo obtiene un proveedor local S3 compatible que puede descargarse desde Docker Hub sin la autenticación que bloqueaba la imagen anterior.
- Para el despliegue final deben configurarse credenciales y endpoints seguros; las credenciales de ejemplo son solo de desarrollo.
- Los volúmenes de MinIO y SeaweedFS no son intercambiables. Esta configuración no migra datos binarios existentes; si se hubieran guardado objetos en MinIO, se deben copiar con una herramienta S3 antes de retirar su volumen.
- La compatibilidad se limita a las operaciones S3 que utiliza actualmente el backend; no implica compatibilidad total con todas las extensiones de MinIO.

## Referencias

- [SeaweedFS: S3 API](https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API)
- [SeaweedFS: proyecto y despliegue Docker](https://github.com/seaweedfs/seaweedfs)
- [SeaweedFS: configuración de seguridad](https://github.com/seaweedfs/seaweedfs/wiki/Security-Configuration)
