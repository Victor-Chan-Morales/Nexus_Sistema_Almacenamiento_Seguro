# Evidencia SPEC-802: T4, prueba manual con dos S3 (2026-11-06)

Respuestas de la API en `evidencia/` (JSON, sin credenciales). Revisadas con `grep` antes de guardarlas.

## Entorno

- API local (`dist/main.js`) con `DESTINATION_ALLOW_PRIVATE=true`, PostgreSQL de desarrollo.
- SeaweedFS principal (`localhost:8333`, bucket `nexus-dev`): almacén de entorno.
- Segundo SeaweedFS (`10.53.103.144:8334`, bucket `cliente-a`, contenedor `nexus-s3-cliente`): destino propio.
- Commits probados: `5c54dd4` (T3), `be39ac3` (arreglos), `87bba85` y `8d81af6` (auditoría).

## Resultados

| Caso | Acción | Resultado | Evidencia |
|---|---|---|---|
| E1 | `POST /destinations` con credenciales | 201, `Sin comprobar`, sin credenciales en la respuesta | `E1-crear.json` |
| E2 | Valor cifrado en la base | Empieza por `v1.`; no contiene la clave ni el secreto en claro | consulta SQL, abajo |
| E3 | Prueba con datos correctos | `Conectado`, `reason: null` | `E3-prueba-ok.json`, `E3-ok-2.json` |
| E3 | Secreto incorrecto | `Sin conexión`, `AUTH` | `E3-auth.json` |
| E3 | Bucket inexistente | Primera ejecución: `Conectado` (defecto, corregido en `be39ac3`). Después: `Sin conexión`, `BUCKET_NOT_FOUND` | `E3-bucket.json` (antes), `E3-bucket-2.json` (después) |
| E3 | Contenedor detenido | `Sin conexión`, `NETWORK` | `E3-network.json` |
| E4 | `GET /destinations` | Sin credenciales; el destino de entorno tiene `endpoint: null` | `E4-listar.json` |
| E5 | `PATCH` solo con `bucket` | `Sin comprobar`; la prueba siguiente conecta, así que la `secretKey` se conservó | `E3-restaurar-2.json`, `E3-ok-2.json` |
| E6a | Deshabilitar con carpeta activa | 422 `DESTINATION_IN_USE` | `E6a-en-uso.json` |
| E6b | Deshabilitar sin uso | 200 | `E6b-deshabilitar.json` |
| E6c | Escribir en destino deshabilitado | 409 con mensaje propio (`be39ac3`) | `E6c-escribir-deshabilitado.json` (antes del cambio de mensaje) |
| E6d | Leer archivo de destino deshabilitado | 200, SHA-256 igual al original | consola |
| E6e | Reactivar | 200 | `E6e-reactivar.json` |
| E7 | Deshabilitar el predeterminado | 422 `DESTINATION_IN_USE` | `E7-predeterminado.json` |
| E8 | Endpoint `http://localhost:8334` | 422 `DESTINATION_ENDPOINT_NOT_ALLOWED` | `E8-loopback.json` |
| E10 | Subida a carpeta con destino propio | Objeto solo en `cliente-a` (56 bytes cifrados) | listado del bucket |
| E10 | Subida a carpeta de entorno | Objeto solo en `nexus-dev` (72 bytes cifrados) | listado del bucket |
| E10 | Descarga de ambos archivos | 200, SHA-256 igual al original | consola |
| L1-L5 | Verificación tras los arreglos | 409 con mensaje propio (`L2-probar-409.json`); purga de la carpeta de prueba, 64 bytes liberados (`L5-purga.json`) | `evidencia/L*.json` |
| V1-V2 | Verificación del resultado de auditoría | Destino en un puerto cerrado: `Sin conexión`, `NETWORK`; la auditoría guarda `failure` y `NETWORK` | `evidencia/V*.json` y consulta SQL |
| Seguridad | Secreto en logs, evidencias y auditoría | 0 coincidencias | `grep` y consulta SQL |
| Auditoría | Eventos de destino | `DESTINATION_CREATED` 1, `DESTINATION_UPDATED` 7, `DESTINATION_TESTED` 8 (antes del cambio de resultado) | consulta SQL |
| Auditoría | Resultado de la prueba fallida | `DESTINATION_TESTED`, `failure`, `NETWORK` | verificación posterior, `87bba85` |

No probado a mano: la revalidación del endpoint cuando el DNS cambia. La cubre una prueba unitaria.

## Consultas

Cifrado (E2):

```sql
select (connection_details_encrypted like 'v1.%'),
       position('<secreto>' in connection_details_encrypted) > 0
from files.destination where destination_id = '<id>';
```

Resultado: `t`, `f`.

Auditoría de la verificación posterior:

```sql
select action_type, result, safe_reason
from audit.audit_event where resource_id = '<id>' order by chain_seq;
```

Resultado: `DESTINATION_CREATED | success |`; `DESTINATION_TESTED | failure | NETWORK`.

## Datos de prueba

Al terminar se borraron: la carpeta de prueba con sus dos archivos (purga), el destino "Cliente A", el bucket `cliente-a`, el contenedor y el volumen del segundo S3, y el destino de verificación. Los eventos de auditoría no se borran: la cadena es inmutable.

## Desviaciones registradas

- `storage/storage.module.ts`: registra `FilesCryptoService` para que el router descifre las credenciales propias.
- Módulo de auditoría (`audit.types.ts`, `audit.service.ts`, `audit-chain-writer.ts`, `audit-outbox.service.ts` y su entidad), con migración `20261106100000`. Cambia el formato de los eventos nuevos, que ahora incluyen `result` y `safe_reason` en el hash. Pendiente de revisión de su dueño.

## Pruebas automatizadas de la revisión previa a la PR

- `destinations.routes.spec.ts`: colaborador recibe `403 FORBIDDEN_ROLE` en las cuatro rutas (escenario 9); un error de validación con credenciales no las refleja (riesgo de la spec).
- Suite completa de la API: 644 de 644 pruebas.

## Pendiente antes de fusionar

- Aprobación de Anthony del cambio en el módulo de auditoría (revisión en la PR).
- Aprobación del coordinador.
