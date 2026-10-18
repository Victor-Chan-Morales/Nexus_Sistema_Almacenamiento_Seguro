# Devolución para Miguel — PR #5 Files, Storage y SeaweedFS

**Fecha:** 2026-10-17
**Devolución dirigida a:** Miguel (responsable de Files/Storage; indicado en la PR)
**Usuario autor en GitHub:** `rmonteblack`
**Área:** Files / Storage
**PR:** [PR #5](https://github.com/Victor-Chan-Morales/Nexus_Sistema_Almacenamiento_Seguro/pull/5)
**Instrucción vigente:** corregir la PR #5 directamente contra `CONTRACTS.md` v0.3, aprobado por Víctor como integrador el 2026-10-18. No hace falta esperar otra aprobación ni proponer rutas alternativas. El contrato v0.3 resuelve explícitamente el Drive raíz y la respuesta de elementos de carpeta.

Se revisó el diff de la PR y se contrastó con los contratos, planes y decisiones vigentes del repositorio. No se ejecutaron pruebas; los pasos o capturas incluidos por el autor no se consideran verificación independiente del estado actual de la rama.

---

### Correcciones necesarias

1. **Devolver exactamente las formas de v0.3.** El controlador y servicio no deben exponer entidades TypeORM ni arreglos crudos:
   - `GET /api/folders` → `{ drive: { id, name, rootFolderId }, items: [...] }`. `drive` representa `Mi espacio`; `items` son las carpetas hijas de la raíz.
   - `POST /api/folders` → `{ id, name, parentFolderId, driveId, createdAt }`.
   - `GET /api/folders/:id/items` → `{ folder, folders: [], files: [] }`. El campo `folder` es obligatorio y describe la carpeta consultada.
   - Los archivos listados y cargados incluyen `{ id, name, mimeType, sizeBytes, versionId, uploadedAt }`; `id` es `FileRecord.id`, `versionId` la versión actual.
   - `POST /api/files/upload` acepta multipart `folderId` y `file`; `GET /api/files/:id/download` devuelve bytes, no JSON con URL, y un `Content-Disposition` seguro. CORS debe exponer ese header.

   Si las entidades actuales no permiten devolver `driveId`, `rootFolderId` o la carpeta raíz, implementar el Drive/carpeta inicial del contrato mediante la integración transaccional de registro. No rellenar esos campos con valores inventados.

2. **Eliminar rutas duplicadas de compatibilidad.** El PR agrega `/files/folders` además de `/folders`. `CONTRACTS.md` v0.3 ya fija las rutas canónicas: usa `/folders` y `/folders/:id/items`, elimina las rutas paralelas y actualiza los consumidores que dependan de ellas.

3. **Hacer efectiva la idempotencia.** `Idempotency-Key` se lee, pero no se persiste ni se consulta. Repetir la misma solicitud crea otro registro y otra clave de objeto. Persistir la clave con alcance de organización y resultado, resolver carreras concurrentes y devolver la respuesta original para la misma operación. La restricción única debe impedir duplicados aun con solicitudes simultáneas.

4. **Implementar el versionado aprobado.** Cada carga asigna `versionNumber = 1` y crea un `FileRecord` nuevo. Según ADR-003, volver a cargar el mismo nombre en la misma carpeta crea una versión del mismo archivo; debe incrementar secuencialmente, conservar los bytes previos, actualizar la versión actual y devolver su `versionId`. La clave de objeto no debe ser la única fuente del historial.

5. **No usar el nombre original en la clave S3.** `objectKey` incluye `file.originalname`. La regla aprobada dice que el backend genera una clave opaca asociada al tenant y que el nombre original es metadato visible, no ruta. Usar una clave interna como `<organizationId>/<fileId>/v<numero>`; normalizar/validar el nombre solo para presentación y descarga.

6. **Contar correctamente la cuota y reservar cargas.** `getUsedStorageBytes()` suma el `sizeBytes` real de cada `FileVersion` que aún está almacenada para la organización. Incluye versiones anteriores y versiones en papelera durante los 30 días de retención. No sumes también `FileRecord.sizeBytes`, porque duplica la versión actual. Mantén las reservas aparte: cada carga y cada downgrade consideran `usedBytes + reservedBytes`; crea y libera la reserva de forma atómica para que cargas concurrentes no excedan la cuota. El límite sin plan es cero y la cuota excedida responde `422` con `STORAGE_QUOTA_EXCEEDED`.

7. **Validar MIME/tamaño con respuestas correctas.** La expresión regular de MIME acepta categorías amplias (por ejemplo, cualquier MIME que contenga `text`) y no comprueba una lista exacta de tipos ni coherencia con extensión/contenido. Validar el conjunto aprobado PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT y ZIP; responder `415` ante tipo no admitido y `413` ante tamaño excedido, según `CONTRACTS.md`. No confiar en `mimetype` enviado por el navegador como única evidencia.

8. **Ajustar transferencia y errores.** El interceptor usa buffer en memoria hasta 100 MB, por lo que la implementación no es una carga streaming como afirma la descripción. Para el límite acordado, documentar y controlar el impacto de memoria o implementar streaming con límite real. En descarga, usar `pipeline`/manejo de error del stream para evitar respuestas truncadas sin control. El nombre de `Content-Disposition` debe usar una codificación segura compatible con nombres UTF-8, sin permitir separadores de ruta. No exponer errores crudos del proveedor S3 al cliente.

9. **Conservar aislamiento multi-tenant en todo el flujo.** La comprobación de carpeta por organización es correcta como base; completar el mismo patrón para listar carpetas/elementos, subir, descargar, borrar y obtener versiones. Un UUID de otra organización debe comportarse como inexistente y no revelar su presencia.

10. **Resolver almacenamiento duplicado y referencias MinIO.** El PR añade `apps/api/src/modules/files/storage/MinioStorageService` con variables `MINIO_*` además de la implementación vigente `apps/api/src/modules/storage/StorageService` para SeaweedFS. Eliminar la implementación heredada si no tiene consumidor aprobado. El frontend y Files deben usar solo el contrato de Storage del monolito; SeaweedFS queda detrás de ese módulo.

11. **Alinear configuración e infraestructura.** `docker-compose.yml`, `.env.example`, puertos, nombres de servicio y guía local deben coincidir con ADR-004 y con la forma de ejecución documentada. No dupliques migraciones bajo `apps/db/database/migrations`: la ubicación canónica aprobada es `database/migrations/` en la raíz. Entrega los cambios de esquema al integrador para que los consolide en un solo PR coordinado, conforme a `CONTRIBUTING.md`.

12. **Limpiar archivos no funcionales.** Quitar `apps/api/tsconfig*.tsbuildinfo`, `.Rhistory`, `prueba.txt`, `package.json`/lockfiles temporales y cualquier dump o semilla que no sea parte aprobada del proyecto. Revisar el seed que contiene referencias a MinIO y valores placeholder para que no parezca una instalación real ni contradiga los datos vigentes.

### Contrato aprobado que debe implementar (v0.3)

- Navegador → API Nexus exclusivamente; no exponer S3 credentials, bucket, endpoint interno ni object key.
- `GET /folders`, `POST /folders`, `GET /folders/:id/items`, `POST /files/upload` y `GET /files/:id/download` usan las rutas y respuestas exactas de `CONTRACTS.md` v0.3. El listado raíz incluye `drive.rootFolderId`; el detalle incluye `folder`.
- Multipart lleva `file`, `folderId` y opcionalmente `Idempotency-Key`; el máximo es `100000000` bytes. Tipos: PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT y ZIP.
- Uso confirmado suma todas las versiones persistidas retenidas, incluida la papelera por 30 días; reserva y uso se consideran en cargas y downgrade.
- Éxito solo cuando bytes y metadatos quedaron confirmados. Si falla Storage/BD, compensar el objeto huérfano y no mostrar éxito.
- Tenant derivado del JWT; validar organización/carpeta/permisos en cada request.
- SeaweedFS es el proveedor de `StorageService` según ADR-004; PostgreSQL contiene metadatos/versiones, Storage contiene bytes.

### Falta implementar o demostrar

- Respuestas DTO exactas, provisión de Drive/raíz y descarga binaria con nombre UTF-8 comprobado.
- Idempotencia con reintento y concurrencia.
- Versionado real y cuota que incluya papelera y versiones según ADR-003.
- Validación MIME y comportamiento `413`/`415`/cuota/Storage caído.
- Evidencia repetible: subir archivo permitido, confirmar listado único, descargar y comparar hash/contenido, probar recurso de otro tenant y SeaweedFS detenido.
- Un único lugar canónico para migraciones/semillas y README actualizado desde el entorno realmente probado.

**Referencias:** `Planes de trabajo individuales/PLAN_MIGUEL_FILES_STORAGE.md`, `Planes de trabajo individuales/PLAN_ANTHONY_VALIDACION_SEAWEEDFS.md`, `Planes de trabajo individuales/PLAN_VICTOR_INTEGRACION_SEAWEEDFS.md`, `CONTRACTS.md`, reglas de archivos de `BUSINESS_RULES.md`, ADR-003, ADR-004 y `ARCHITECTURE.md`.

---
## Criterios para solicitar nueva revisión

- [ ] `GET /folders` incluye Drive y `rootFolderId`; `GET /folders/:id/items` devuelve la carpeta consultada además de carpetas y archivos.
- [ ] Carpetas, subida multipart y descarga binaria usan rutas y DTO de `CONTRACTS.md` v0.3.
- [ ] `Idempotency-Key` evita duplicados también ante reintentos concurrentes.
- [ ] Repetir nombre en la misma carpeta crea una nueva versión del mismo archivo; cada versión conserva bytes y metadatos.
- [ ] La clave del objeto la genera el servidor sin incluir el nombre original; el uso incluye todas las versiones retenidas y papelera según v0.3.
- [ ] MIME, tamaño, tenant, compensación y errores S3 obedecen las reglas y códigos HTTP documentados.
- [ ] Queda una sola implementación Storage SeaweedFS, una sola ruta de migraciones y no se incluyen artefactos temporales.
- [ ] Se adjunta evidencia reproducible de carga/listado/descarga íntegra, cuota, tipos inválidos, fallo Storage y aislamiento por tenant.
