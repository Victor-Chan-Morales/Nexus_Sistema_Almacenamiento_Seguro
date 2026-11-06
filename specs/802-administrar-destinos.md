# SPEC-802: ADMINISTRAR DESTINOS

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (credenciales y migración) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/`, `apps/api/src/modules/storage/`, `database/migrations/` |
| **Requisitos Vinculados** | RF-014, RF-015 |
| **Dependencias** | SPEC-801 |
| **Prioridad** | P1 |
| **Estimación** | 3 h |
| **Estado** | Implementada (2026-11-06). Aprobada el 2026-11-04 por Víctor Chán Morales |

## 2. Objetivo

El administrador registra almacenes S3 propios, clasificados como nube o servidor local, y comprueba que funcionan. Las credenciales se guardan cifradas y nunca se devuelven.

## 3. Fuera de Alcance

- Elegir modelo ni asignar carpetas (SPEC-803).
- Pantallas (SPEC-804).
- Migrar archivos entre destinos.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Registrar
  Dado un tenant_admin
  Cuando envía POST /destinations con { name, location, providerType, endpoint, bucket, region, accessKey, secretKey, useSsl }
  Entonces responde 201 con estado "Sin comprobar" y sin credenciales

Escenario 2: Credenciales protegidas
  Entonces connection_details_encrypted está cifrado
  Y ninguna respuesta, log ni evento contiene accessKey ni secretKey

Escenario 3: Probar conexión
  Cuando envía POST /destinations/:id/test
  Entonces escribe, lee, compara y borra un objeto de prueba
  Y el estado pasa a "Conectado", o a "Sin conexión" con un motivo seguro

Escenario 4: Listar
  Cuando envía GET /destinations
  Entonces ve sus destinos con nombre, ubicación, proveedor, estado y si es predeterminado

Escenario 5: Actualizar
  Cuando envía PATCH /destinations/:id
  Entonces el estado vuelve a "Sin comprobar"
  Y una secretKey omitida conserva la actual

Escenario 6: Deshabilitar
  Cuando envía { isEnabled: false }
  Entonces no se puede escribir en él, y sus archivos se siguen leyendo

Escenario 7: En uso o predeterminado
  Dado el destino predeterminado o uno asignado a carpetas activas
  Cuando intenta deshabilitarlo → 422 DESTINATION_IN_USE

Escenario 8: Endpoint no permitido
  Dado un endpoint a loopback, link-local o metadatos de nube (169.254.169.254)
  Entonces responde 422 DESTINATION_ENDPOINT_NOT_ALLOWED, sin conectarse
  Y un rango privado solo se admite con DESTINATION_ALLOW_PRIVATE=true

Escenario 9: Permisos y aislamiento
  Dado un colaborador → 403 FORBIDDEN_ROLE
  Dado un destino de otra organización → 404

Escenario 10: Uso real
  Dado un destino registrado
  Entonces StorageRouter usa sus credenciales, y las de entorno siguen funcionando en los destinos antiguos
```

## 5. Contrato de API

| Método y ruta | Respuesta |
|---|---|
| `POST /destinations` | `201 DestinationDto` |
| `GET /destinations` | `{ items: DestinationDto[] }` |
| `PATCH /destinations/:id` | `200 DestinationDto` |
| `POST /destinations/:id/test` | `200 { status, checkedAt, reason }` |

`DestinationDto`: `{ id, name, location, providerType, endpoint, bucket, region, connectionStatus, isEnabled, isDefault, createdAt }`. Todas: `tenant_admin`.

Errores nuevos: `422 DESTINATION_IN_USE`, `422 DESTINATION_ENDPOINT_NOT_ALLOWED`.

## 6. Datos y Esquema

```sql
-- migrate:up
CREATE TYPE files.destination_location AS ENUM ('cloud', 'on_premises');
ALTER TABLE files.destination
  ADD COLUMN location files.destination_location NOT NULL DEFAULT 'cloud',
  ADD COLUMN name varchar(150) NOT NULL DEFAULT 'Almacenamiento Nexus';
-- migrate:down: quitar columnas y tipo
```

`connection_details_encrypted` guarda `{ endpoint, bucket, region, accessKey, secretKey, useSsl }` cifrado.

## 8. Diseño Técnico

- **`FilesCryptoService.decryptConnectionDetails`:** **hoy no existe** (solo `encryptConnectionDetails`). Agregar con el mismo contexto `destination:<org>:v1`; coordinar el formato con SPEC-005.
- **`StorageRouter`:** datos con `environment:*` → `StorageService`; con credenciales → `S3ObjectStorage` con su propio `S3Client`, en una caché por `destinationId` que se invalida al actualizar.
- **`DestinationsService` y `DestinationsController`.**
- **Prueba de conexión:** clave `.nexus-connection-test/<uuid>`, tiempo límite 10 s. El motivo se reduce a categorías (`AUTH`, `NETWORK`, `BUCKET_NOT_FOUND`, `DATA_MISMATCH`); nunca el mensaje crudo del SDK.
- **SSRF:** resolver el DNS del host y rechazar loopback, link-local y metadatos. Rangos privados solo con la bandera, para on-premises y desarrollo. Repetir la validación antes de cada prueba.
- **Auditoría:** `DESTINATION_CREATED`, `DESTINATION_UPDATED`, `DESTINATION_TESTED`.
- **Riesgo:** credenciales en errores de `ValidationPipe`. El DTO no refleja valores.

## 9. Plan de Tareas

- [x] **T1 (30 min)**: Migración, entidad y descifrado. (`75aa411`)
- [x] **T2 (50 min)**: CRUD con validación del endpoint. (`0d4d175`)
- [x] **T3 (50 min)**: Prueba de conexión y `StorageRouter` real. (`5c54dd4`)
- [x] **T4 (50 min)**: Pruebas y prueba manual con un segundo contenedor S3. Evidencia en `docs/evidencia/spec-802/RESUMEN.md`.

**Archivos permitidos:** la migración, `files/destinations.service.ts`, `files/destinations.controller.ts`, `files/dto/destination.dto.ts`, sus specs (nuevos), `files/entities/destination.entity.ts`, `files/files-crypto.service.ts` y su spec, `files/files.module.ts`, `storage/storage-router.service.ts`, `audit/audit.types.ts`, `.env.example`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1, 2, 4–9 | Unitaria | `destinations.service.spec.ts` |
| Escenario 3 con fallos simulados | Unitaria | `destinations.service.spec.ts` |
| Escenarios 3, 10 reales | Manual con dos contenedores | Evidencia en el PR |

## 11. Impacto en Documentación

- [x] `CONTRACTS.md` v0.6, `ADR-006` §2.5, `ENTS_REGISTRY.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
| 2026-11-06 | Claude Code | Implementada en `feat/802-administrar-destinos` (T1 a T3): migración de `name` y `location`, descifrado, CRUD con validación de endpoint, prueba de conexión y `StorageRouter` con credenciales propias. Documentación actualizada: `CONTRACTS.md` v0.6, `ADR-006` §2.5, `ENTS_REGISTRY.md`, `ARCHITECTURE.md` y READMEs de Files y Storage. |
| 2026-11-06 | Claude Code | T4 ejecutada con dos S3 (SeaweedFS). Corregidos: bucket inexistente que aparecía como conectado (`HeadBucket` antes de probar, `be39ac3`); mensaje del 409 (`CONFLICT` con texto propio, `be39ac3`); `DESTINATION_TESTED` registra `failure` y la causa segura (`87bba85`, `8d81af6`). Esto añadió `result` y `safe_reason` al outbox de auditoría (migración `20261106100000`). Desviaciones de archivos permitidos: `storage/storage.module.ts` (registra `FilesCryptoService`) y el módulo de auditoría (cambio de formato del evento, pendiente de revisión por su dueño). |
