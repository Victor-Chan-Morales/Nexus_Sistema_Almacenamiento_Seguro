# Plan de migración de Files/Storage de MinIO a SeaweedFS

**Responsable:** Miguel  
**Rama de origen:** `feature/miguel/files-storage-mvp`  
**Objetivo:** conservar el MVP funcional de Files y sustituir MinIO por SeaweedFS sin cambiar el contrato HTTP ni la persistencia de metadatos en PostgreSQL.

## Estado inicial verificado

La rama de Miguel contiene el flujo de carpetas, carga multipart, descarga por stream, versiones, validación de tenant y consulta de cuota. Sin embargo, su plan y la evidencia de entrega siguen nombrando MinIO.

La rama agrega `MinioStorageService` basado en AWS SDK S3, pero `FilesService` sigue inyectando el `StorageService` existente en `apps/api/src/modules/storage`, que usa el cliente `minio`. Hay dos contratos de Storage distintos (`put/get/delete` frente a `uploadFile/getFileStream/deleteFile`) y el nuevo proveedor S3 no está conectado a `FilesModule`. La configuración de Docker y la documentación de la rama también apuntan a MinIO. Por ello, primero se debe unificar el punto de integración y luego cambiar el proveedor.

## Decisiones y límites

- SeaweedFS reemplaza el servicio de objetos; PostgreSQL conserva archivos, carpetas, versiones, claves de objeto, tamaños y MIME.
- Mantener las rutas y respuestas actuales del MVP, salvo cambios aprobados en `CONTRACTS.md`.
- Files no debe conocer detalles específicos de MinIO o SeaweedFS. Debe depender de un único contrato de almacenamiento in-process.
- No eliminar ni recrear volúmenes durante la migración. Los objetos existentes en MinIO no aparecen automáticamente en SeaweedFS.
- No declarar completada la migración hasta demostrar escritura, lectura y eliminación contra SeaweedFS desde el API.

## Fase 1 — Cerrar el contrato y unificar Storage

1. Revisar `FilesService`, `FilesModule`, `StorageModule`, el proveedor nuevo de la rama y `CONTRACTS.md`.
2. Elegir un contrato único con operaciones equivalentes a `put`, `get` y `delete`, con manejo explícito de streams, tamaño y MIME.
3. Hacer que `FilesService` consuma ese contrato por inyección; quitar la dependencia directa de `MinioStorageService` y evitar mantener dos módulos/proveedores incompatibles.
4. Mantener una implementación del proveedor seleccionada por configuración. El adaptador SeaweedFS usará el endpoint S3 del gateway, credenciales, región y direccionamiento compatibles configurables.
5. Definir creación/verificación del bucket y comportamiento cuando SeaweedFS no esté disponible. La inicialización debe ser repetible y no reportar la API como lista si el proveedor requerido no está disponible.

**Criterio de salida:** `FilesService` no importa SDKs ni nombres de proveedor; un único módulo Storage ofrece el contrato usado en carga, descarga y compensación.

## Fase 2 — Configurar SeaweedFS local

1. Incorporar a `docker-compose.yml` los servicios de SeaweedFS necesarios para maestro, volumen y gateway S3, con puertos internos coherentes y persistencia en volúmenes nombrados.
2. Configurar credenciales S3 y bucket de forma segura mediante variables de entorno y actualizar `.env.example`; no incluir secretos reales ni defaults de producción.
3. Añadir healthchecks y `depends_on` con condición de salud para el servicio S3 que usa la API.
4. Actualizar scripts y guías de inicio, apagado y logs para que levanten SeaweedFS en lugar de MinIO.
5. Mantener puertos distintos entre host y red Docker claramente documentados: el API en Compose debe usar el nombre de servicio y puerto interno del gateway S3.

**Criterio de salida:** un entorno limpio levanta PostgreSQL, SeaweedFS y API con el procedimiento documentado; el API detecta el endpoint correcto dentro de la red Docker.

## Fase 3 — Adaptador y configuración del API

1. Sustituir variables `MINIO_*` por nombres neutrales (`STORAGE_*`) para endpoint, región, bucket, access key, secret, SSL y path-style; documentar valores de desarrollo.
2. Configurar el cliente S3 con endpoint del gateway de SeaweedFS y path-style si es requerido por el entorno. No asumir compatibilidad total de MinIO: confirmar las operaciones usadas con la versión elegida de SeaweedFS.
3. Implementar/ajustar las operaciones de guardar, obtener stream y eliminar objeto. Propagar fallos de forma segura sin devolver credenciales, endpoint privado ni claves al cliente.
4. Preservar claves generadas por backend con prefijo de organización y referencias ya guardadas en `FileVersion.objectKey`.
5. Asegurar que una subida solo se confirma cuando objeto y metadatos/versiones quedaron persistidos; una falla de PostgreSQL debe intentar borrar el objeto compensatorio.

**Criterio de salida:** la misma API de Files funciona con SeaweedFS; cambiar configuración de Storage no requiere cambiar controladores ni lógica de negocio.

## Fase 4 — Verificar el flujo completo

Verificar manualmente en entorno local y registrar evidencia reproducible:

- Crear carpeta autenticado y listar su contenido.
- Subir un archivo permitido pequeño; comprobar metadatos/versiones en PostgreSQL y objeto en SeaweedFS.
- Descargarlo y comparar el contenido con el original.
- Subir una nueva versión y comprobar que se descarga la versión más reciente sin perder la anterior.
- Eliminar lógicamente un archivo y confirmar el comportamiento esperado de sus bytes y de la cuota.
- Rechazar formato/tamaño no permitido y cuota excedida.
- Un usuario de otra organización no puede listar ni descargar el objeto.
- Con SeaweedFS detenido, la API no confirma una carga ni revela detalles internos.
- Forzar fallo de persistencia posterior a la carga y comprobar la compensación o registrar claramente el objeto huérfano si el borrado también falla.

Guardar comandos, respuestas HTTP, identificadores anonimizados y resultado de inspección del bucket. No reutilizar como evidencia resultados que corresponden a MinIO.

**Criterio de salida:** matriz de verificación con todos los escenarios, configuración/versión de SeaweedFS y evidencia de descarga íntegra.

## Fase 5 — Migrar objetos existentes (solo si existen datos que conservar)

1. Confirmar si el volumen MinIO contiene archivos que deban conservarse. No borrar el volumen de origen.
2. Preparar un procedimiento de copia de objetos que preserve exactamente las claves de `FileVersion.objectKey` y valide conteos/tamaños/checksums.
3. Ejecutar primero una prueba con una muestra; registrar fallos y capacidad de reintento idempotente.
4. Cambiar el proveedor activo solo tras validar que todos los objetos referenciados por PostgreSQL existen y son legibles en SeaweedFS.
5. Mantener MinIO y su volumen como respaldo hasta la aceptación del equipo. La eliminación se decide después de verificar integridad y recuperación.

Si el proyecto solo usa datos de desarrollo descartables, documentar que no hay migración de datos y recrear únicamente los datos de prueba con autorización del equipo.

## Fase 6 — Documentación y limpieza

- Actualizar `PLAN_MIGUEL_FILES_STORAGE.md`, `ENTREGA_FILES_STORAGE_50.md`, `README.md`, `ARCHITECTURE.md`, `CONTRACTS.md` cuando aplique, `.env.example` y documentación de Docker.
- Reemplazar afirmaciones de “validado en MinIO” por resultados de SeaweedFS solo después de ejecutar la verificación.
- Quitar dependencias, variables, servicios y comentarios de MinIO que ya no use el proyecto; conservar referencias históricas solo si se explican como migración.
- Revisar que no se incorporaron archivos de compilación como `*.tsbuildinfo` ni archivos de prueba temporales como `prueba.txt`.

## Hallazgos del MVP que deben resolverse antes del cierre

- El adaptador S3 agregado en la rama no está conectado: `FilesService` consume el proveedor MinIO anterior.
- La idempotencia se guarda en un `Set` en memoria, por lo que no es compartida entre procesos y se pierde al reiniciar; debe persistirse o declararse fuera del alcance contractual.
- La cuota suma `FileRecord.sizeBytes` de archivos no borrados, aunque el plan exige contabilizar bytes retenidos en todas las versiones y definir el trato de papelera. Acordar semántica con Billing antes de cerrar.
- La compensación depende de una búsqueda dinámica de `delete`; debe usar el contrato tipado único y no ocultar el fallo de limpieza.
- La validación de MIME debe cubrir explícitamente los tipos autorizados y no basarse solo en una expresión amplia; validar también tamaño real recibido.
- Revisar nombres/relaciones Drive y aprovisionamiento inicial: el plan menciona `driveId`, pero el servicio mostrado crea carpetas sin Drive.
- La evidencia de entrega nombra MinIO y contiene IDs/datos de prueba. Repetir los escenarios contra SeaweedFS y reemplazar la evidencia con resultados reales, sin exponer datos personales.

## Entregables de Miguel

1. Un solo contrato de Storage y adaptador SeaweedFS conectado al módulo Files.
2. Compose y variables de entorno para SeaweedFS, con volúmenes y healthchecks.
3. Flujo comprobado de carga, versión, descarga y eliminación/compensación.
4. Evidencia de aislamiento multi-tenant, límites, cuota y fallo del proveedor.
5. Documentación actualizada y lista de dependencias/configuración MinIO retiradas.
6. PR que incluya únicamente cambios del MVP Files/Storage y la migración, sin artefactos de compilación ni archivos temporales.
