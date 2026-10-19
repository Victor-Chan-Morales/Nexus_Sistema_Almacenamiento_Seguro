### `ENTREGA_FILES_STORAGE_50.md`

Reemplaza el contenido completo de `ENTREGA_FILES_STORAGE_50.md` en la raíz del proyecto con la siguiente documentación basada en la ejecución real:

```markdown
# Informe de Pruebas Funcionales y Evidencia Reproducible — Files & Storage (PR #5)

- **Fecha de ejecución:** 2026-10-19
- **Rama validada:** `feature/miguel/files-storage-mvp`
- **Infraestructura:** PostgreSQL 16 (puerto `5433`) + SeaweedFS S3 Gateway (puerto `8333`)
- **Especificaciones verificadas:** `CONTRACTS.md` v0.3, `ADR-003` y `ADR-004`
- **Estado:** ✅ Validado y Operativo 

---

## 1. Consulta de Espacio Personal y Raíz (`GET /api/folders`)

Verifica la devolución del objeto canónico `drive` (`Mi espacio`) con su identificador real, su carpeta raíz `rootFolderId` (`Archivos`) y la lista de carpetas disponibles.

**Respuesta recibida (`200 OK`):**
```json
{
  "drive": {
    "id": "1684db15-adb8-4a1e-8454-3c41ffe9b0cf",
    "name": "Mi espacio",
    "rootFolderId": "b3b11a8e-f006-4233-8160-52b162d8dfd7"
  },
  "items": []
}

```

---

## 2. Creación de Subcarpeta (`POST /api/folders`)

Verifica la creación jerárquica asociando el `driveId` real de la organización y el `parentFolderId`.

**Payload enviado:**

```json
{
  "name": "Subcarpeta Evaluacion",
  "parentFolderId": "b3b11a8e-f006-4233-8160-52b162d8dfd7"
}

```

**Respuesta recibida (`201 Created`):**

```json
{
  "id": "3c4e968b-966c-4847-8972-38f1622eec69",
  "name": "Subcarpeta Evaluacion",
  "parentFolderId": "b3b11a8e-f006-4233-8160-52b162d8dfd7",
  "driveId": "1684db15-adb8-4a1e-8454-3c41ffe9b0cf",
  "createdAt": "2026-10-19T17:25:15.559Z"
}

```

---

## 3. Carga Inicial v1 e Idempotencia (`POST /api/files/upload`)

Se ejecuta la carga enviando `folderId` obligatorio y la cabecera `Idempotency-Key`. Se realiza inmediatamente un reintento con la misma clave para comprobar que no se generen duplicados.

**Petición 1 (Creación v1):**

```json
{
  "id": "d74f11c8-af7e-4cfc-b1a3-b03e5f0fb49d",
  "name": "documento.txt",
  "mimeType": "text/plain",
  "sizeBytes": "50",
  "versionId": "4427e9ec-7902-4a2b-80b0-73fbbdf8ee1b",
  "uploadedAt": "2026-10-19T17:25:15.766Z"
}

```

**Petición 2 (Reintento con misma `Idempotency-Key`):**

```json
{
  "id": "d74f11c8-af7e-4cfc-b1a3-b03e5f0fb49d",
  "name": "documento.txt",
  "mimeType": "text/plain",
  "sizeBytes": "50",
  "versionId": "4427e9ec-7902-4a2b-80b0-73fbbdf8ee1b",
  "uploadedAt": "2026-10-19T17:25:15.766Z"
}

```

*Resultado: Idéntico identificador de archivo (`d74f11c8...`) y versión (`4427e9ec...`) sin duplicación de registros físicos.*

---

## 4. Versionado Secuencial (`ADR-003`)

Se realiza una segunda subida con el mismo nombre (`documento.txt`) dentro de la misma carpeta. El sistema preserva el registro del archivo maestro e incrementa la versión física a `v2` en SeaweedFS y PostgreSQL.

**Respuesta recibida (`201 Created`):**

```json
{
  "id": "d74f11c8-af7e-4cfc-b1a3-b03e5f0fb49d",
  "name": "documento.txt",
  "mimeType": "text/plain",
  "sizeBytes": "63",
  "versionId": "94e7f772-5963-4d0a-99a2-4dc6ccde1c41",
  "uploadedAt": "2026-10-19T17:25:16.305Z"
}

```

*Resultado: Se conserva el `id` original del archivo (`d74f11c8...`) y se genera el nuevo `versionId` (`94e7f772...`) actualizando el tamaño a 63 bytes.*

---

## 5. Exploración de Carpeta (`GET /api/folders/:id/items`)

Comprueba la devolución del contenedor `folder` padre y la estructura de archivos con sus datos de versión activa (`versionId`, `uploadedAt`).

**Respuesta recibida (`200 OK`):**

```json
{
  "folder": {
    "id": "3c4e968b-966c-4847-8972-38f1622eec69",
    "name": "Subcarpeta Evaluacion",
    "parentFolderId": "b3b11a8e-f006-4233-8160-52b162d8dfd7",
    "driveId": "1684db15-adb8-4a1e-8454-3c41ffe9b0cf",
    "createdAt": "2026-10-19T17:25:15.559Z"
  },
  "folders": [],
  "files": [
    {
      "id": "d74f11c8-af7e-4cfc-b1a3-b03e5f0fb49d",
      "name": "documento.txt",
      "mimeType": "text/plain",
      "sizeBytes": "63",
      "versionId": "94e7f772-5963-4d0a-99a2-4dc6ccde1c41",
      "uploadedAt": "2026-10-19T17:25:16.305Z"
    }
  ]
}

```

---

## 6. Descarga por Streaming y Validación Criptográfica SHA-256

Verifica la entrega de cabeceras seguras (`Content-Disposition` con codificación UTF-8 / RFC 5987 expuesto en CORS) y la integridad byte a byte entre el archivo subido y el stream recuperado desde SeaweedFS.

**Cabeceras HTTP capturadas:**

```http
Access-Control-Expose-Headers: Content-Disposition
Content-Type: text/plain; charset=utf-8
Content-Disposition: attachment; filename="documento.txt"; filename*=UTF-8''documento.txt

```

**Verificación de Hash SHA-256:**

* **SHA-256 Archivo Local Subido (v2):** `6648E6928D8DB32B5E0EA402F5A0EB93DCD999B852F7BD87CA4B78996DEE2928`
* **SHA-256 Archivo Descargado de Storage:** `6648E6928D8DB32B5E0EA402F5A0EB93DCD999B852F7BD87CA4B78996DEE2928`
* **Coincidencia Exacta:** `True` (Integridad 100% verificada)

---

## 7. Validación de Códigos de Error (`CONTRACTS.md`)

### 7.1. Omisión de `folderId` obligatorio (`HTTP 400 Bad Request`)

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Datos ausentes o mal formados",
  "requestId": "89d5f51b-4f3b-42c3-bf1b-ba71dd9f62f7"
}

```

*Código de estado:* `400`

### 7.2. Extensión o tipo MIME no admitido (`HTTP 415 Unsupported Media Type`)

Petición con archivo binario `.exe`:

```json
{
  "code": "UNSUPPORTED_MEDIA_TYPE",
  "message": "Tipo de contenido no permitido",
  "requestId": "0d94f8b9-bf9e-45bd-af54-179377b444f4"
}

```

*Código de estado:* `415`

### 7.3. Aislamiento Multi-Tenant (`HTTP 404 Not Found`)

Consulta de identificador ajeno a la organización activa:

```json
{
  "code": "NOT_FOUND",
  "message": "Recurso no encontrado",
  "requestId": "85852eba-ff42-4d4f-9edd-e09bf2609a72"
}

```

*Código de estado:* `404`

```