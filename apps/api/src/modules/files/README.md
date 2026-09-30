# Módulo Storage (Proveedor de Almacenamiento)

**Propietario:** Miguel
**Propósito:** Encapsular la lógica de comunicación con el proveedor de almacenamiento de objetos (MinIO/S3), manteniendo a los servicios de dominio de Files aislados de los SDKs de infraestructura.

- **`StorageProvider`:** Interfaz estricta (SOLID) para subir, bajar y eliminar archivos.
- **`MinioStorageService`:** Adaptador local que utiliza `@aws-sdk/client-s3`.
- **Manejo de Huérfanos:** Si falla Postgres tras subir un archivo, el backend ejecuta `deleteFile()` como compensación para no dejar basura en MinIO.

## 🚀 Resumen de Cambios: MVP 30% - Módulo de Files & Storage

Se ha completado la arquitectura base y la configuración inicial de la API para el manejo y almacenamiento de archivos utilizando NestJS y MinIO.

### 🛠️ 1. Corrección de Infraestructura y Monorepo
- **Docker:** Se actualizó la imagen de MinIO en el `docker-compose.yml` utilizando `pgsty/minio:latest` para resolver los problemas de los repositorios públicos obsoletos, asegurando que los contenedores de Postgres y MinIO levanten correctamente.
- **Configuración Monorepo:** Se corrigió el archivo `package.json` raíz añadiendo `"apps/api"` a los workspaces. 
- **Inicialización de API:** Se crearon desde cero los archivos de configuración de NestJS (`main.ts`, `app.module.ts`, `nest-cli.json`, `tsconfig.json`) para que el backend compile y ejecute sin errores en el entorno aislado.

### 🏗️ 2. Arquitectura del Módulo Storage (Principios SOLID)
- Se implementó la interfaz `StorageProvider` para mantener la lógica de negocio desacoplada de la infraestructura.
- Se creó `MinioStorageService` como adaptador, utilizando `@aws-sdk/client-s3` para comunicarse con el contenedor local de MinIO.
- Se dejó preparada la lógica de compensación (rollback) para eliminar archivos huérfanos en caso de fallos futuros en la base de datos.

### 🔌 3. Controlador y Rutas Base
- Se expuso el endpoint `POST /v1/files/upload` en el `FilesController`.
- Se integró `Multer` (`FileInterceptor`) para recibir correctamente los archivos `multipart/form-data` desde el cliente.
- Se preparó la inyección de metadatos básicos y la validación de la cabecera `Idempotency-Key`.

### 🎯 Estado Actual y Próximos Pasos
- **Estado:** La API enciende correctamente en el puerto `3001` y se comunica con MinIO. Está lista para que el Frontend (Víctor) comience las pruebas de integración de subida de archivos físicos.
- **Pendiente (MVP 60%):** Conectar PostgreSQL, validar el límite de cuotas (`tenant_quota`) y registrar la metadata de los archivos en la base de datos relacional.