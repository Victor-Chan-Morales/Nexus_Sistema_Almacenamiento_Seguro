# Plan individual de Víctor: integración y aceptación de SeaweedFS

**Responsabilidad actual:** integración del frontend con la API.  
**Trabajo complementario:** asegurar que el cambio de MinIO a SeaweedFS sea transparente para el navegador y que el equipo pueda verificar el flujo de archivos usando el contrato HTTP existente.

## Objetivo

Integrar y verificar el flujo de carpetas, subida, listado y descarga contra la API del monolito después de que Miguel conecte SeaweedFS al módulo Storage. El frontend no se conecta directamente a SeaweedFS ni recibe credenciales, bucket, object keys o URLs internas del proveedor.

## Dependencias

- Miguel confirma rutas, campos multipart, respuestas, límites, estados HTTP y configuración local de API/SeaweedFS.
- Anthony confirma los errores de cuota y las reglas que debe mostrar la interfaz.
- Sebastián confirma cómo obtener el JWT y la organización activa para el flujo de pruebas.

## Tareas

### 1. Confirmar el contrato HTTP

- Revisar `CONTRACTS.md` y el cliente de API de archivos en `apps/web/src/lib/api/`.
- Confirmar con Miguel los endpoints vigentes para crear/listar carpetas, consultar elementos, subir y descargar archivos.
- Acordar nombres multipart (`file`, `folderId`), formato de respuestas, MIME y `Content-Disposition`.
- No mantener rutas duplicadas de compatibilidad sin que el contrato lo apruebe.

**Resultado verificable:** matriz de endpoint, método, entrada, respuesta y errores que consume la interfaz.

### 2. Revisar la interfaz sin acoplarla al proveedor

- Confirmar que la carga se hace contra la API Nexus y que el navegador no usa el endpoint S3 de SeaweedFS.
- Mostrar estados de carga, éxito, archivo demasiado grande/tipo no permitido, cuota excedida, falta de sesión, recurso no encontrado y error temporal de Storage.
- Mantener los metadatos visibles (nombre, tamaño, MIME y fecha) según respuesta de Files.
- Descargar por el endpoint autenticado y respetar el nombre seguro entregado mediante `Content-Disposition`.
- Evitar mostrar claves de objeto, nombres de bucket, endpoint interno o mensajes crudos del proveedor.

**Resultado verificable:** el flujo UI no cambia de contrato por sustituir el proveedor; no aparecen referencias a MinIO/SeaweedFS en componentes o llamadas del navegador.

### 3. Validar el flujo extremo a extremo

Con el entorno de integración proporcionado por Miguel:

1. Iniciar sesión con una organización de prueba.
2. Crear o abrir una carpeta y listar su contenido.
3. Subir un archivo de tipo y tamaño permitidos.
4. Confirmar que aparece una sola vez en el listado con metadatos correctos.
5. Descargarlo y comparar su contenido con el archivo original.
6. Verificar mensajes claros ante cuota excedida, archivo inválido, sesión expirada y SeaweedFS fuera de servicio.
7. Verificar que cambiar de organización no muestra archivos de la organización anterior.

Registrar navegador/ambiente, pasos, resultado y referencias a evidencia. No declarar pruebas realizadas basándose solo en el código o en una captura aislada.

### 4. Actualizar guías de desarrollo

- Actualizar las instrucciones de inicio que todavía mencionen MinIO, sus puertos o su consola.
- Documentar cómo iniciar SeaweedFS junto a PostgreSQL y API, los endpoints de usuario y los errores esperados.
- Asegurar que `.env.example` y README no contengan secretos reales.
- Coordinar con Miguel para que la documentación describa la configuración probada, incluidos nombres de servicio y puertos internos Docker.

## Entregables

1. Cliente frontend alineado con el contrato confirmado de Files.
2. Estados de carga/descarga y errores útiles para el usuario.
3. Evidencia reproducible del flujo UI → API → SeaweedFS → API → UI.
4. Documentación de arranque y uso revisada para SeaweedFS.

## Criterios de cierre

- [ ] El frontend se comunica únicamente con la API del monolito.
- [ ] Subir y descargar conservan el contrato vigente y reproducen el contenido original.
- [ ] La UI maneja errores de cuota y Storage sin mostrar detalles internos.
- [ ] Se validó el aislamiento al cambiar de organización.
- [ ] README y guía local ya no instruyen a levantar MinIO.
- [ ] La evidencia distingue resultados observados de tareas pendientes.
