# SPEC-210: DESCARGAR Y RESTAURAR UNA VERSIÓN ANTERIOR

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (cuota y cifrado) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/`, `apps/web/src/components/` |
| **Requisitos Vinculados** | RF-008 |
| **Dependencias** | SPEC-206, SPEC-207 |
| **Prioridad** | P1 |
| **Estimación** | 2.5 h |
| **Estado** | Implementada (2026-11-05). Aprobada el 2026-11-04 por Víctor Chán Morales |

## 2. Objetivo

Completar RF-008: bajar cualquier versión y volver a una anterior. Restaurar **crea una versión nueva**, así que no se pierde historia.

## 3. Fuera de Alcance

- Borrar versiones individuales.
- Comparar versiones.
- Restaurar archivos en la papelera: primero se restaura el archivo.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Descargar versión anterior
  Dado un archivo propio con versiones 1, 2 y 3
  Cuando envía GET /files/:id/versions/:versionId/download con la versión 1
  Entonces recibe los bytes exactos de la versión 1 con nombre seguro

Escenario 2: Restaurar
  Cuando envía POST /files/:id/versions/:versionId/restore con la versión 1
  Entonces se crea la versión 4 con el contenido de la 1 y pasa a ser la vigente
  Y las versiones 1, 2 y 3 siguen disponibles

Escenario 3: Cuota
  Dado que el tamaño de la versión no cabe en la cuota
  Entonces responde 422 STORAGE_QUOTA_EXCEEDED y no crea nada

Escenario 4: Ya vigente
  Dada la versión vigente → 422 VERSION_ALREADY_CURRENT

Escenario 5: Versión de otro archivo o ajena
  Entonces responde 404, incluso con un versionId válido de otro archivo

Escenario 6: En papelera
  Dado un archivo en la papelera → 404

Escenario 7: Pantalla
  Dado el modal de versiones
  Entonces cada versión no vigente ofrece "Descargar" y "Restaurar" con confirmación
  Y al restaurar se recarga el modal
```

## 5. Contrato de API

| Método y ruta | Respuesta |
|---|---|
| `GET /files/:id/versions/:versionId/download` | Bytes y `Content-Disposition` |
| `POST /files/:id/versions/:versionId/restore` | `200 { fileId, versionId, versionNumber, sizeBytes, uploadedAt }` |

Error nuevo: `422 VERSION_ALREADY_CURRENT`.

## 6. Datos y Esquema

Sin migración.

## 7. Interfaz de Usuario

Extender el modal de SPEC-207. Mensajes para cuota y errores. Estados de proceso por fila.

## 8. Diseño Técnico

Nuevo `FileVersionsService`:

```typescript
listVersions(...)  // se mueve aquí desde SPEC-206 si ya existe en files.service.ts
readVersionBytes(organizationId: string, file: FileRecord, version: FileVersion): Promise<Buffer>;
downloadVersion(fileId, versionId, actor): Promise<{ stream, mimeType, name }>;
restoreVersion(fileId, versionId, actor): Promise<RestoredVersionDto>;
```

- `readVersionBytes` lee del almacén y descifra con `FilesCryptoService`. **La reutiliza SPEC-216.**
- **Restaurar** debe descifrar y re-cifrar: el AAD incluye `versionNumber`, así que el objeto viejo no se puede reutilizar con otro número.
- Restaurar llama a `FilesService.uploadMultipartFileWithVersion` con `{ buffer, originalname: file.name, mimetype: file.mimeType }` y `restore: { fileId, sourceVersionId, sourceChecksum }`. Ya resuelve reserva de cuota, cifrado, compensación e idempotencia.
- **Modo restaurar (revisión PR 52):** la carga no busca el archivo por nombre. Dentro de su transacción bloquea el archivo por id (`FOR UPDATE`) y exige que siga activo y en la misma carpeta; si no, responde 404 y no escribe nada. Con el bloqueo, decide si la vigente ya tiene ese contenido (mismo SHA-256 que el `checksum` de la versión) y responde 422 `VERSION_ALREADY_CURRENT`. Así dos restauraciones del mismo contenido no crean dos versiones, aunque vengan de pestañas distintas.
- **Auditoría:** `uploadMultipartFile` ya emite `FILE_UPLOAD`. Agregar `FILE_VERSION_RESTORED` con el mismo `correlationId`, y `FILE_DOWNLOAD` al bajar.
- **Riesgos y límites conocidos:**
  - Memoria: descargar y restaurar cargan la versión completa. Al restaurar el pico es de unas 2 a 3 veces el tamaño del archivo (hasta ~300 MB con 100 MB). Restaurar cuenta dentro del límite de 3 cargas simultáneas por usuario; descargar no. **No se resuelve en esta spec:** el cifrado es AES-GCM sobre el objeto completo, y hacerlo por bloques cambia el formato almacenado. Requiere una SPEC propia.
  - Dos pestañas con contenidos distintos siguen pudiendo restaurar a la vez; cada una crea su versión, en el orden en que se bloquea el archivo. Es lo esperado: no hay pérdida de datos.
  - Restaurar una versión cuyo contenido ya es el de la vigente responde 422, aunque sea otra versión con otro número.

## 9. Plan de Tareas

- [x] **T1 (50 min)**: `FileVersionsService` y rutas.
- [x] **T2 (30 min)**: Restaurar y auditoría.
- [x] **T3 (30 min)**: Modal.
- [x] **T4 (40 min)**: Pruebas.

**Archivos permitidos:** `files/file-versions.service.ts` y sus specs (nuevos), `files/files.controller.ts`, `files/files.module.ts`, `files/files.service.ts` (modo restaurar, validación de `folderId`, `versionNumber` en el resultado), `files/files.*.spec.ts` (los de carga y auditoría se ajustan a UUIDs de fixture), `audit/audit.types.ts`, `files/README.md`, el componente del modal de SPEC-207, `lib/api/files.ts`, `lib/api/types.ts`, `lib/api/README.md`, `file-browser-live.tsx` (prop `onRestored`), `globals.css` (clases del modal; disposición de la lista según su ancho con una consulta de contenedor), `CONTRACTS.md` y `specs/README.md`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–6 | Unitaria | `file-versions.service.spec.ts` |
| Carrera con papelera, contenido ya vigente | Unitaria | `file-versions.service.spec.ts`, `files.restore-upload.spec.ts` |
| Modo restaurar: bloqueo por id, 404, 422, versión nueva | Unitaria | `files.restore-upload.spec.ts` |
| `folderId` que no es UUID → 400 antes de la base | Unitaria | `files.restore-upload.spec.ts` |
| Rutas: `:id` y `:versionId` no UUID → 400; contrato 200 | HTTP (supertest) | `files.routes.spec.ts` |
| Escenario 7 y solapamiento de acciones (con y sin panel de detalle, 390–1920 px) | Manual, Chromium contra la app real | 17 comprobaciones; capturas en `docs/evidencia/spec-210/` |
| Restauración, descarga, papelera y concurrencia contra PostgreSQL y SeaweedFS reales | Manual, API | 24 comprobaciones; objetos leídos en crudo con SigV4 (cifrados) |
| Escenario 2 con bytes reales | Manual con SeaweedFS | Evidencia en el PR |
| Escenario 7 | Manual | Capturas en el PR |

## 11. Impacto en Documentación

- [x] `CONTRACTS.md` v0.6.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
| 2026-11-05 | Claude Code | Revisión de la PR 52: cierre de los 7 hallazgos. Restaurar bloquea el archivo por id y responde 404 si está en papelera; el contenido igual a la vigente responde 422; se elimina la lectura posterior al commit; `folderId` no UUID responde 400; `:id` no UUID responde 400 en las rutas nuevas; pruebas HTTP de rutas; disposición de la lista según su ancho (consulta de contenedor a 710 px; la columna de acciones pasa a tener 216 px) y no solo con el panel abierto; límite de memoria documentado. Pruebas manuales: 24 comprobaciones de API y 17 de pantalla, todas en verde; capturas en `docs/evidencia/spec-210/`. Ver «Riesgos y límites conocidos». |
| 2026-11-05 | Claude Code | Implementada. Pruebas unitarias en `file-versions.service.spec.ts` (escenarios 1–6). Restaurar con bytes reales verificado contra SeaweedFS local (21 comprobaciones). `versionId` no UUID responde 400 (`ParseUUIDPipe`). Escenario 7 comprobado en Chromium headless (Playwright, 10 comprobaciones, incluido móvil 390 px sin scroll horizontal). Pendiente: capturas en la PR. |
