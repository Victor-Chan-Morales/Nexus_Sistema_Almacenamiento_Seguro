
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

### 🎯 4. Estado Actual (MVP 60% Completado)
- **Estado:** La API enciende correctamente en el puerto `3001` y se comunica con MinIO.
- **Integración con BD:** Se conectó nativamente con PostgreSQL. El endpoint principal ahora valida en tiempo real el límite de cuotas de la organización (`tenant_quota` de 5GB), rechaza archivos mayores a 100MB y registra los metadatos transaccionales en las tablas `files.file` y `files.file_version` respetando el aislamiento por inquilino. Está listo para que el Frontend (Víctor) comience las pruebas de integración.

---

## 🚀 Guía de Inicio Rápido (Levantar y Probar)

Para probar el flujo completo del sistema, sigue estos pasos en orden:

### Requisitos Previos
* **Docker Desktop** (encendido y corriendo)
* **Node.js** (v18+)

### Paso 1: Configurar Variables de Entorno
Copia el archivo de variables de entorno de la base de datos.
**⚠️ IMPORTANTE:** Edita el nuevo archivo `.env` y asegúrate de que el puerto de PostgreSQL sea `5433` (para evitar conflictos con instalaciones locales en Windows).

```bash
cp apps/db/.env.example apps/db/.env

```

### Paso 2: Levantar la Infraestructura (Docker)

Inicia los contenedores aislados de PostgreSQL y MinIO:

```bash
docker compose -f apps/db/docker-compose.yml up -d

```

### Paso 3: Crear Tablas e Inyectar Datos de Prueba

Para que la API funcione, inyectaremos las tablas (migraciones) y los UUIDs de la Organización y carpetas de prueba requeridas:

```bash
# 1. Correr migraciones estructurales (Crea las tablas)
docker compose -f apps/db/docker-compose.yml --profile tools up migrate

# 2. Copiar e inyectar datos semilla para desarrollo (Inserta los UUIDs mock)
docker cp apps/db/database/seeds/001_dev_seed.sql paas_postgres:/tmp/seed.sql
docker exec paas_postgres psql -U paas_app -d paas_platform -f /tmp/seed.sql

```

### Paso 4: Encender la API Backend

Con la infraestructura lista, levanta el servidor de NestJS:

```bash
npm run dev:api

```

*(Debes ver en la consola el mensaje: "Conexión a PostgreSQL establecida correctamente").*

### Paso 5: Prueba de Subida de Archivos (End-to-End)

Abre una **nueva pestaña** en tu terminal para enviar un archivo real y comprobar que todo el flujo funciona.

1. Crea un documento local de prueba:

```powershell
echo "Documento de prueba MVP" > prueba.txt

```

2. Ejecuta esta petición `curl` apuntando a la carpeta raíz de prueba:

```powershell
curl.exe -X POST http://localhost:3001/v1/files/upload `
  -H "Idempotency-Key: prueba-123" `
  -F "folderId=00000000-0000-0000-0000-000000000031" `
  -F "file=@prueba.txt"

```

**✅ Respuesta Exitosa Esperada:**
El servidor validará la cuota de la organización, procesará el archivo y retornará los metadatos generados:

```json
{
  "id": "b06758bb-9289-482a-ad53-bd412ad6cf60",
  "versionId": "d9738e55-123a-4146-a18c-d724fe4eed49",
  "name": "prueba.txt",
  "sizeBytes": 90
}

```