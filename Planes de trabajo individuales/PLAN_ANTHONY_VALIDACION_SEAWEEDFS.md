# Plan individual de Anthony: compatibilidad de Billing con SeaweedFS

**Responsabilidad actual:** Billing (planes, suscripciones y cuotas).  
**Trabajo complementario:** asegurar que el cambio del proveedor de objetos de MinIO a SeaweedFS no altere la validación de cuota ni el contrato entre Billing y Files.

## Objetivo

Conservar la regla de cuota del producto durante la migración. Billing sigue siendo el origen del límite de almacenamiento por organización; Files sigue midiendo el uso y llamando a `BillingService` dentro del monolito. SeaweedFS almacena bytes, pero no reemplaza PostgreSQL ni el cálculo de cuota.

## Fuera de alcance

- Implementar el adaptador S3 de SeaweedFS o modificar Docker Compose.
- Cambiar el contrato HTTP de Files o agregar acceso directo a SeaweedFS desde Billing.
- Reescribir el esquema de base de datos salvo que se acuerde un cambio de contrato con el responsable de migraciones.

## Tareas

### 1. Confirmar el contrato de cuota

- Revisar `BillingService.getStorageLimitBytes(organizationId)` y documentar su unidad de retorno (bytes), tratamiento de organización sin suscripción y errores.
- Confirmar con Miguel qué límite se verifica antes de subir un objeto y qué errores recibe Files.
- Confirmar que el cambio de endpoint/credenciales de Storage no modifica la llamada interna de Files a Billing.

**Resultado verificable:** contrato escrito y consistente entre `BillingService`, `FilesService` y la documentación funcional.

### 2. Acordar cómo se contabiliza el uso

- Definir con Miguel si el uso incluye todas las versiones retenidas, archivos en papelera y cargas incompletas.
- Asegurar que el tamaño contabilizado provenga de bytes confirmados por el servidor y de metadatos persistidos; no aceptar tamaños enviados por el cliente como fuente de verdad.
- Documentar cómo se trata un fallo entre guardar el objeto en SeaweedFS y persistir la versión en PostgreSQL.
- Evitar que Billing consulte directamente tablas de Files o el API de SeaweedFS; mantener la responsabilidad de uso en Files.

**Resultado verificable:** regla de cálculo aprobada por Billing y Files, con ejemplos de versión nueva, papelera, cuota excedida y error de almacenamiento.

### 3. Verificar escenarios de integración

Coordinar con Miguel y registrar el resultado para:

- Organización bajo el límite: Billing devuelve el límite esperado y Files permite continuar.
- Organización en el límite: una carga que lo excede se rechaza sin dejar versión confirmada.
- Plan sin capacidad de almacenamiento o suscripción no válida: respuesta coherente con las reglas de Billing.
- SeaweedFS no disponible: Files devuelve error de almacenamiento y no se registra uso como carga exitosa.
- Reintento después de una falla: no debe duplicar uso ni crear una versión fantasma.

No marcar la migración de SeaweedFS como aprobada solo porque el endpoint de Billing responde; comprobar el resultado desde el flujo Files integrado.

### 4. Actualizar documentación de Billing

- Actualizar únicamente las referencias de Billing que describan el almacenamiento como MinIO o atribuyan a Billing la gestión de objetos.
- Explicar que Billing define límites; Files calcula uso; SeaweedFS almacena los bytes.
- No declarar pruebas ejecutadas hasta adjuntar fecha, ambiente, escenario y resultado observado.

## Entregables

1. Contrato de cuota con unidad y escenarios límite.
2. Regla acordada de contabilización de versiones y papelera.
3. Evidencia de los escenarios de integración con SeaweedFS proporcionada por Miguel.
4. Documentación de Billing corregida sin referencias de proveedor obsoletas.

## Criterios de cierre

- [ ] Files obtiene el límite mediante `BillingService` in-process.
- [ ] Las reglas de uso no dependen del proveedor MinIO/SeaweedFS.
- [ ] Una falla de SeaweedFS no crea una carga exitosa ni incrementa el uso confirmado.
- [ ] La cuota excedida se rechaza antes de confirmar el objeto y sus metadatos.
- [ ] Las pruebas manuales y sus resultados están documentados con evidencia reproducible.
