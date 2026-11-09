# Evidencia SPEC-803: prueba manual con dos S3

Prueba ejecutada contra la API compilada (`apps/api/dist/main.js`) con `DESTINATION_ALLOW_PRIVATE=true`, PostgreSQL de desarrollo y dos almacenes S3: el de entorno (`localhost:8333`, bucket `nexus-dev`) y un segundo SeaweedFS ad hoc (`10.53.103.144:8334`, bucket `cliente-e8`, contenedor retirado al terminar). Las credenciales del segundo almacén y los tokens de sesión no se guardan en el repositorio.

Respuestas revisadas antes de incluirlas: no contienen `accessKey`, `secretKey`, `endpoint` de los destinos ni tokens.

## Resultados

| Escenario | Acción | Resultado | Verificación |
|---|---|---|---|
| 1 Consultar | `GET /organizations/storage-policy` como administrador y colaborador | 200 con `model`, `defaultDestinationId` y `destinations: [{id, name, location}]`, sin credenciales | respuesta |
| 2 Cambiar a Local | `PUT` con `on_premises` y el destino Local conectado como predeterminado | 200; el modelo cambia y ese destino pasa a predeterminado | `files.destination`: solo el Local tiene `is_default = true`; las 2 raíces de Drive apuntan al Local |
| 3 Requisitos | `PUT` con `on_premises` sin destino Local conectado | 422 `DEPLOYMENT_MODEL_REQUIREMENTS_UNMET`: "Necesitas un destino de Servidor local conectado para elegir este modelo" | respuesta; la política no cambia |
| 3 Requisitos (híbrido) | `PUT` con `hybrid` con un destino de cada ubicación | 200 | respuesta |
| 4 Nada se mueve | Cambio de modelo con 31 versiones en el destino de Nube | Las 31 versiones conservan su destino; una versión anterior se descarga | BD: `file_version` sin cambios; descarga 200, 1211 bytes |
| 5 Nube o Local por modelo | Carpeta principal sin `destinationId` en `on_premises` | 201 con el destino predeterminado (`on_premises`) | respuesta |
| 5 Nube o Local por modelo | Carpeta principal con `destinationId` en `on_premises` | 422 `DESTINATION_SELECTION_NOT_ALLOWED` | respuesta |
| 6 Principal en híbrido | Carpeta principal con `destinationId` Local en `hybrid` | 201, `destinationId` y `destinationLocation: on_premises` | respuesta |
| 7 Falta el destino | Carpeta principal en `hybrid` sin `destinationId` | 201 con el predeterminado (Nube) | respuesta |
| 8 Subcarpetas | Subcarpeta con `destinationId` | 422 `DESTINATION_SELECTION_NOT_ALLOWED` | respuesta |
| 8 Subcarpetas | Subcarpeta sin `destinationId` | 201; hereda `on_premises` de su padre | respuesta |
| 9 Subida real | Un archivo en carpeta Local y otro en carpeta de Nube | Cada objeto está solo en su bucket. `version.destination_id` coincide con el destino de su carpeta | BD y listados de `cliente-e8` y `nexus-dev` |
| 10 Destino inválido | Carpeta principal en `hybrid` con un identificador inexistente | 422 `DESTINATION_NOT_AVAILABLE` | respuesta |
| 10 Destino inválido | `PUT` con `on_premises` y el destino de Nube como predeterminado | 422 `DEPLOYMENT_MODEL_REQUIREMENTS_UNMET` (ubicación incompatible); no cambia nada | respuesta |
| 11 Solicitud | `POST /organizations/installation-requests` | 201 `Pendiente` | respuesta |
| 11 Solicitud | Segunda solicitud con la primera pendiente | 409 `INSTALLATION_REQUEST_PENDING` | respuesta |
| 12 Permisos | Colaborador: `PUT` de la política, `POST` y `GET` de solicitudes | 403 `FORBIDDEN_ROLE` en las tres | respuestas |
| 12 Permisos | Colaborador: `GET` de la política | 200 (solo lectura) | respuesta |

## Auditoría

| Evento | Recurso | Resultado | Veces |
|---|---|---|---|
| `DEPLOYMENT_MODEL_CHANGED` | `organization` | success | 2 |
| `INSTALLATION_REQUESTED` | `installation_request` | success | 1 |
| `FOLDER_CREATE` | `folder` | success | 10 |

Consulta de seguridad: ningún registro de `audit.audit_event` contiene `secret` o `accesskey` en `safe_reason`.

## Cifrado en reposo

El destino Local tiene `connection_details_encrypted` con prefijo `v1.` y no contiene el secreto en claro.

## Desviaciones y notas

- **Dirección del segundo almacén:** se registró con la IP de la LAN (`10.53.103.144`), no con `localhost`. SPEC-802 bloquea loopback siempre, incluso con `DESTINATION_ALLOW_PRIVATE=true`. Esto corrige la indicación de SPEC-804 §8 (ver su Registro de Cambios).
- **Escenario 4:** se comprobó el estado de la descarga y el tamaño, no un SHA-256 frente al original, porque el original no se conservó.
- **Escenario 10 (destino deshabilitado):** no se probó a mano. Está cubierto por `destination-defaults.service.spec.ts` y `folder-placement.service.spec.ts`. En este entorno los destinos con carpetas activas no se pueden deshabilitar (`DESTINATION_IN_USE`, SPEC-802).
- **Datos de prueba:** las carpetas, versiones, destinos y eventos de auditoría de la prueba se quedan en la base de desarrollo, porque la cadena de auditoría es inmutable. El contenedor del segundo almacén se retiró al terminar.
