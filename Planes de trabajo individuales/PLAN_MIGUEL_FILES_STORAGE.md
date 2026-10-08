# Plan individual de Miguel para Files y Storage

**Responsabilidad:** carpetas, metadatos, carga y descarga de archivos en Files; almacenamiento binario mediante Storage/SeaweedFS dentro del monolito modular.

## Resultado esperado

Una persona autenticada crea/lista una carpeta, carga un archivo permitido, ve sus metadatos y descarga el mismo contenido. PostgreSQL conserva metadatos y versiones; SeaweedFS conserva bytes. Todas las operaciones validan tenant y cuota en la API.

## Pasos de trabajo

### 1. Confirmar contratos y modelo

- Leer `PLAN_INTEGRACION_50_PORCIENTO.md`, `CONTRACTS.md`, `BUSINESS_RULES.md`, `ENTS_REGISTRY.md`, `ARCHITECTURE.md` y ADR-003.
- Revisar `FilesController`, `FilesService`, entidades y `StorageService`.
- Usar las rutas del contrato como objetivo: `GET/POST /folders`, `GET /folders/:id/items`, `POST /files/upload`, `GET /files/:id/download`.
- El controlador actual usa rutas distintas y aún no expone carga. Alinear rutas y DTO con el contrato antes de pedir integración web; no mantener dos juegos de endpoints.

**Entrega verificable:** matriz de ruta, entrada, salida y validación acordada con Víctor.

### 2. Carpetas y consultas aisladas

- Listar y crear carpetas dentro de la organización autenticada.
- Validar que la carpeta padre pertenece al mismo tenant; rechazar nombres inválidos y referencias ajenas sin revelar su existencia.
- Coordinar con Sebastián la provisión inicial `Mi espacio` + `Archivos` establecida por ADR-003. Definir la entidad/relación Drive que exige el contrato (`driveId`) sin confiar en IDs enviados por el navegador.
- Exponer a IAM una operación de aprovisionamiento inicial reutilizable para que el registro cree Drive/carpeta raíz de forma consistente y coordinada con la transacción de usuario/organización/membresía.
- Implementar listado conjunto de carpetas/archivos para `GET /folders/:id/items`, con paginación solo si el contrato lo define.
- Derivar tenant y actor de `req.user`; ignorar o rechazar `organizationId` recibido del cliente.

**Entrega verificable:** crear/listar carpeta y consultar sus elementos con una sesión válida; no hay lectura cruzada entre tenants.

### 3. Implementar carga multipart real

- Exponer `POST /files/upload` con `multipart/form-data` (`folderId`, `file`) y aceptar `Idempotency-Key` si se implementa según contrato.
- Validar carpeta/tenant, tipos de ADR-003 (PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT y ZIP), máximo inicial de 100 MB y cuota antes de confirmar la carga.
- Medir bytes reales en servidor. Consultar `BillingService.getStorageLimitBytes(organizationId)` mediante inyección directa; no hacer HTTP entre módulos.
- Calcular uso desde las versiones/objetos retenidos que ocupan espacio, incluyendo elementos en papelera según ADR-003; no usar un tamaño reportado por navegador ni contar solo la última versión si las versiones anteriores siguen guardadas.
- Generar la clave de objeto en servidor con prefijo tenant; guardar el stream en `StorageService` y persistir metadatos/versión en PostgreSQL.
- Si falla la persistencia después de guardar el objeto, intentar compensar eliminándolo y registrar el error sin exponer datos internos.
- No devolver éxito hasta confirmar objeto y metadatos. Revisar el manejo de una fila de archivo creada antes de completar Storage para evitar residuos incompletos.

**Entrega verificable:** archivo pequeño sube, aparece en PostgreSQL y su objeto puede localizarse en SeaweedFS; tamaño/cuota excedidos se rechazan en API.

### 4. Listar y descargar

- Devolver metadatos de archivo necesarios para UI: id, nombre, MIME, tamaño en bytes y fecha/versión según contrato.
- Exponer un método público de `FilesService` para obtener uso confirmado en bytes; Víctor lo consume desde `DashboardModule` sin consultar tablas Files directamente.
- Implementar `GET /files/:id/download` protegido por JWT, comprobar tenant y recurso, y transmitir bytes con `Content-Disposition` seguro y `Content-Type` apropiado.
- Consumir `StorageService.get(objectKey)`; no devolver claves de bucket ni mensajes internos del proveedor.
- Mantener manejo de archivos en papelera y versiones existentes sin expandir el hito a papelera completa.

**Entrega verificable:** descarga reproduce el mismo contenido subido y un UUID de otro tenant devuelve error seguro.

### 5. Integrar cuota y revisar

- Coordinar con Anthony la semántica de cuota: bytes reales confirmados, archivos en papelera y plan activo.
- Avisar a Víctor de estados HTTP, respuestas y estados UI: cargando, éxito, cuota/tamaño excedido, error Storage y recurso no encontrado.
- Documentar escenarios de éxito, cuota, tamaño, SeaweedFS no disponible y aislamiento entre organizaciones; abrir PR revisable.

## Archivos principales

- `apps/api/src/modules/files/files.controller.ts`
- `apps/api/src/modules/files/files.service.ts`
- `apps/api/src/modules/files/entities/`
- `apps/api/src/modules/storage/storage.service.ts`
- `apps/web/src/lib/api/files.ts` (solo cambios coordinados de contrato/tipos)
- `CONTRACTS.md`, `SESSION_LOG.md`

## Dependencias

- Sebastián aporta el contexto autenticado correcto.
- Anthony exporta BillingService y define límite/unidad; Files lo invoca dentro del proceso.
- Víctor conecta formularios/componentes al contrato confirmado y necesita conocer `Content-Disposition`.

## Cierre de Miguel

- [ ] Bytes en SeaweedFS; metadatos y versiones en PostgreSQL.
- [ ] Carga valida tamaño real, tipo, cuota, carpeta y tenant en servidor.
- [ ] Clave/prefijo lo genera el backend.
- [ ] Descarga entrega bytes y no expone clave interna.
- [ ] Otra organización no puede listar ni descargar el archivo.
- [ ] Error de Storage no produce respuesta falsa de éxito ni secretos en el error.
