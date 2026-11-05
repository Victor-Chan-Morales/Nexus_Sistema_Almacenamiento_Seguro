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
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

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
- Reutilizar `FilesService.uploadMultipartFile` con `{ buffer, originalname: file.name, mimetype: file.mimeType }`. Ya resuelve reserva de cuota, cifrado, compensación e idempotencia; el mismo nombre y carpeta crean una versión nueva (ADR-003).
- **Auditoría:** `uploadMultipartFile` ya emite `FILE_UPLOAD`. Agregar `FILE_VERSION_RESTORED` con el mismo `correlationId`, y `FILE_DOWNLOAD` al bajar.
- **Riesgos:** consumo de memoria igual al límite de 100 MB; el límite de 3 cargas simultáneas también aplica.

## 9. Plan de Tareas

- [ ] **T1 (50 min)**: `FileVersionsService` y rutas.
- [ ] **T2 (30 min)**: Restaurar y auditoría.
- [ ] **T3 (30 min)**: Modal.
- [ ] **T4 (40 min)**: Pruebas.

**Archivos permitidos:** `files/file-versions.service.ts` y su spec (nuevos), `files/files.controller.ts`, `files/files.module.ts`, `audit/audit.types.ts`, el componente del modal de SPEC-207, `lib/api/files.ts`, `lib/api/types.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–6 | Unitaria | `file-versions.service.spec.ts` |
| Escenario 2 con bytes reales | Manual con SeaweedFS | Evidencia en el PR |
| Escenario 7 | Manual | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
