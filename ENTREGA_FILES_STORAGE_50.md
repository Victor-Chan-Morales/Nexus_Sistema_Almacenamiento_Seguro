
# Informe de Entrega: Files & Storage (Hito 50% — Contratos v0.3)

- **Módulo:** `FilesModule` y `StorageModule`
- **Infraestructura:** PostgreSQL 16 (puerto 5433) + SeaweedFS S3 Gateway (puerto 8333)
- **Estado:** ✅ Validado contra `CONTRACTS.md` v0.3 y ADR-003

---

## 1. Arquitectura y Esquema Canónico

1. **Ubicación canónica de migraciones:**
   - Se trasladaron todas las migraciones SQL a `database/migrations/` en la raíz del repositorio, eliminando la fuente duplicada `apps/db`.
   - Se retiró el servicio residual `database.service.ts`.

2. **Aprovisionamiento de Drive:**
   - Modelado de entidad `Drive` (`Mi espacio`) y carpeta raíz (`Archivos`).
   - Respuestas alineadas con `CONTRACTS.md` v0.3 (`drive` con `rootFolderId`, items con `driveId`).

3. **Storage SeaweedFS:**
   - Contrato desacoplado en `StorageService` mediante `@aws-sdk/client-s3`.
   - Generación de claves opacas sin exponer el nombre del archivo: `<organizationId>/<fileId>/v<versionNumber>`.

---

## 2. Evidencia de Pruebas Funcionales (Smoke Test v0.3)

### A. Listado de Carpetas (`GET /folders`)
```json
{
  "drive": {
    "id": "64005dc2-f685-4e89-8f22-2619ad0da522",
    "name": "Mi espacio",
    "rootFolderId": "78c048bf-dac3-4596-947c-89488bdefe22"
  },
  "items": [
    {
      "id": "78c048bf-dac3-4596-947c-89488bdefe22",
      "name": "Archivos",
      "parentFolderId": null,
      "driveId": "64005dc2-f685-4e89-8f22-2619ad0da522"
    }
  ]
}

```

### B. Creación de Carpeta (`POST /folders`)

```json
{
  "id": "e0fbcc8e-efcd-419d-b3af-a2beb72cd404",
  "name": "Subcarpeta Proyectos",
  "parentFolderId": "78c048bf-dac3-4596-947c-89488bdefe22",
  "driveId": "64005dc2-f685-4e89-8f22-2619ad0da522",
  "createdAt": "2026-10-19T09:08:40.364Z"
}

```

### C. Carga de Archivo con Versionado (`POST /files/upload`)

* **Parámetros:** `folderId` obligatorio, `file`, `Idempotency-Key`.

```json
{
  "id": "6c0f9bab-2c40-4cc3-9e19-3f8c3f402bba",
  "name": "reporte.txt",
  "mimeType": "text/plain",
  "sizeBytes": "44",
  "versionId": "dcf08aa8-9e9c-4cd1-9174-73211a93543f",
  "uploadedAt": "2026-10-19T09:08:40.785Z"
}

```

### D. Exploración de Items (`GET /folders/:id/items`)

```json
{
  "folder": {
    "id": "e0fbcc8e-efcd-419d-b3af-a2beb72cd404",
    "name": "Subcarpeta Proyectos",
    "parentFolderId": "78c048bf-dac3-4596-947c-89488bdefe22",
    "driveId": "64005dc2-f685-4e89-8f22-2619ad0da522",
    "createdAt": "2026-10-19T09:08:40.364Z"
  },
  "folders": [],
  "files": [
    {
      "id": "6c0f9bab-2c40-4cc3-9e19-3f8c3f402bba",
      "name": "reporte.txt",
      "mimeType": "text/plain",
      "sizeBytes": "44",
      "versionId": "dcf08aa8-9e9c-4cd1-9174-73211a93543f",
      "uploadedAt": "2026-10-19T09:08:40.785Z"
    }
  ]
}

```

### E. Validaciones de Negocio y Códigos HTTP

* **Tipo no admitido:** Petición con archivo `.exe` devuelve `415 Unsupported Media Type`.


* **FolderId requerido:** Petición sin `folderId` devuelve `400 Bad Request`.


* **Límite de tamaño:** Exactamente `100000000` bytes (HTTP 413).


* **Cuota:** Código `422 Unprocessable Entity` con `{ code: "STORAGE_QUOTA_EXCEEDED" }`.


## Resolución de observaciones — Devolución PR #5 (Contratos v0.3)

Se atendieron y validaron todos los puntos bloqueantes señalados en la revisión:

1. **Migraciones y Esquema Canónico:**
   - Se trasladaron todas las migraciones SQL a `database/migrations/` en la raíz del repositorio, eliminando la fuente duplicada `apps/db` y el servicio obsoleto `database.service.ts`.
   - Se modeló la entidad `Drive` (`Mi espacio`) y se garantizó la inicialización de la carpeta raíz `Archivos`.

2. **DTOs canónicos (`CONTRACTS.md` v0.3):**
   - `GET /folders`: Retorna `{ drive: { id, name, rootFolderId }, items: [{ id, name, parentFolderId, driveId }] }`.
   - `POST /folders`: Retorna `{ id, name, parentFolderId, driveId, createdAt }` con el `driveId` real asociado.
   - `GET /folders/:id/items`: Retorna `{ folder, folders: [], files: [] }`. Cada archivo incluye `versionId` y `uploadedAt`.
   - `folderId` ahora es estrictamente obligatorio en la carga (`HTTP 400` si está ausente).

3. **Cuota, Límites y Tipos de Archivo:**
   - Tamaño máximo exacto ajustado a `100000000` bytes (HTTP 413).
   - Cuota excedida responde `HTTP 422` con `code: "STORAGE_QUOTA_EXCEEDED"`.
   - Validación cruzada estricta de extensión y MIME (HTTP 415 ante formatos no autorizados).
   - Control de concurrencia: límite de 3 cargas simultáneas por usuario (ADR-003).

4. **Limpieza e Informe:**
   - Se eliminaron artefactos de compilación (`*.tsbuildinfo`) y se protegieron en `.gitignore`.
   - `ENTREGA_FILES_STORAGE_50.md` actualizado con los payloads completos y reproducibles.

```