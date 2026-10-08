# Evidencia de Integración y Cierre de Hito 50% — Files & Storage

**Responsable:** Miguel  
**Módulo:** Files & Storage (Monolito Modular NestJS)  
**Fecha:** 07 de Octubre, 2026  
**Rama:** `feature/miguel/files-storage-mvp`  
**Commit Objetivo:** Integración validada contra PostgreSQL y MinIO

---

## 1. Mapeo de Requisitos contra Checklists de Cierre

| Criterio de Aceptación | Estado | Archivos y Referencias de Implementación |
| :--- | :---: | :--- |
| **Bytes en MinIO; metadatos y versiones en PostgreSQL** | **Cumplido** | • `apps/api/src/modules/files/files.service.ts`: Métodos `uploadMultipartFile()` y `findFileById()`.<br>• `apps/api/src/modules/files/entities/`: `FileRecordEntity` y `FileVersionEntity` persisten metadatos y control de versiones vía TypeORM.<br>• `apps/api/src/modules/storage/storage.service.ts`: Inserción de stream binario directo al bucket `nexus-dev` de MinIO. |
| **Carga valida tamaño real, tipo, cuota, carpeta y tenant** | **Cumplido** | • `apps/api/src/modules/files/files.controller.ts`: Filtro MIME regex conforme a ADR-003 y límite de 100 MB (`MaxFileSizeValidator`).<br>• `apps/api/src/modules/files/files.service.ts`: Inyección en proceso de `BillingService.getStorageLimitBytes(organizationId)` para verificar cuota.<br>• Tenant y propietario derivados exclusivamente de `req.user.organizationId` y `req.user.userId`. |
| **Clave/prefijo generado por backend** | **Cumplido** | • `apps/api/src/modules/files/files.service.ts`: Clave de objeto construida internamente con aislamiento por organización (`{organizationId}/{fileId}/{versionId}-{filename}`). |
| **Descarga entrega bytes sin exponer claves internas** | **Cumplido** | • `apps/api/src/modules/files/files.controller.ts`: Endpoint `GET /api/files/:id/download`.<br>• Transmisión por stream HTTP (`Readable.pipe(res)`) con cabeceras `Content-Type` y `Content-Disposition: attachment; filename="..."`. No expone URLs ni credenciales de MinIO. |
| **Aislamiento multi-tenant estricto** | **Cumplido** | • `apps/api/src/modules/files/files.service.ts`: Todas las operaciones filtran por `organizationId`. Si un ID pertenece a otro tenant, se arroja `NotFoundException` (404) para evitar fugas de existencia. |
| **Compensación ante fallos de Storage** | **Cumplido** | • `apps/api/src/modules/files/files.service.ts`: Control de transacciones con bloque compensatorio (`storageService.delete`) en caso de error durante la persistencia en base de datos. |

---

## 2. Matriz de Endpoints Verificados

| Método | Ruta | Estado HTTP | Validación |
| :--- | :--- | :---: | :--- |
| `POST` | `/api/auth/login` | 200 OK | Retorno de JWT con contexto de tenant (`organizationId`) |
| `POST` | `/api/folders` | 201 Created | Creación de carpeta asociada a la organización activa |
| `POST` | `/api/files/upload` | 201 Created | Subida multipart (`multipart/form-data`) persistida en MinIO y PostgreSQL |
| `GET` | `/api/files/:id/download` | 200 OK | Descarga binaria íntegra por stream |

---

## 3. Registro de Pruebas de Humo (Smoke Test Execution)

### A. Creación de Carpeta
* **Endpoint:** `POST /api/folders`
* **Folder ID:** `6580f6eb-e62d-457c-87d4-3281758310fa`
* **Nombre:** `"Carpeta Entrega 50"`

### B. Carga Multipart (`POST /api/files/upload`)
* **Archivo:** `test-upload.txt`
* **Payload de Respuesta (201 Created):**
```json
{
  "id": "8c25bb8f-7a05-4c2b-a094-4da9bdb1597d",
  "name": "test-upload.txt",
  "organizationId": "b0172fa9-6d34-4b29-a9ef-81a2a05b62ca",
  "ownerId": "fa65d210-075c-49a1-92a1-f55ec8ba83a5",
  "folderId": "6580f6eb-e62d-457c-87d4-3281758310fa",
  "mimeType": "text/plain",
  "sizeBytes": "56",
  "isDeleted": false,
  "createdAt": "2026-10-08T07:45:41.956Z",
  "updatedAt": "2026-10-08T07:45:41.956Z"
}