# SPEC-203: RESTAURAR UN ARCHIVO DE LA PAPELERA

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (integridad de datos y regla de nombres) |
| **Responsable Principal** | Miguel (Dominio Files & Storage) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/` |
| **Requisitos Vinculados** | RF-009 |
| **Dependencias** | Ninguna (el evento de auditoría va en SPEC-405) |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) — **prioridad P2** (ver `specs/README.md`) |
| **Estimación** | 1.5 h |
| **Estado** | Aprobada (2026-10-31, Víctor Chán Morales) |

---

## 2. Objetivo

`POST /api/files/:id/restore` devuelve un archivo eliminado a su carpeta original, haciéndolo visible de nuevo en el explorador.

---

## 3. Fuera de Alcance (YAGNI)

- Restaurar carpetas (no se pueden eliminar en este corte).
- Elegir otra carpeta de destino o renombrar al restaurar.
- Restaurar versiones anteriores de un archivo (el historial es de solo lectura, SPEC-206).

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Restauración exitosa
  Dado un archivo propio con is_deleted = true y su carpeta disponible
  Cuando envía POST /api/files/:id/restore
  Entonces responde 200 con { id, name, folderId }
  Y el archivo queda con is_deleted = false y deleted_at = NULL
  Y vuelve a aparecer en GET /folders/:folderId/items

Escenario 2: Archivo ajeno o inexistente
  Dado un id de otra organización, de otro miembro, o inexistente
  Entonces responde 404 y no cambia nada

Escenario 3: Conflicto de nombre
  Dado que la carpeta ya tiene un archivo ACTIVO con el mismo nombre
  Entonces responde 409 FILE_NAME_CONFLICT y el archivo sigue en la papelera

Escenario 4: Carpeta no disponible
  Dado que la carpeta original ya no está disponible
  Entonces responde 409 PARENT_FOLDER_UNAVAILABLE

Escenario 5: El archivo no está en la papelera
  Dado un archivo propio activo
  Entonces responde 404 (no se revela estado)

Escenario 6: La cuota no cambia para un archivo dentro de la retención
  Dado un archivo eliminado hace menos de 30 días (ya cuenta para la cuota)
  Entonces restaurar no modifica los contadores de cuota ni vuelve a comprobar el límite

Escenario 7: Archivo caducado y cuota del plan
  Dado un archivo eliminado hace más de 30 días (ya no cuenta para la cuota)
  Cuando envía POST /api/files/:id/restore
  Y el uso confirmado y reservado más su tamaño superan el límite del plan
  Entonces responde 422 STORAGE_QUOTA_EXCEEDED y el archivo sigue en la papelera
  Y si cabe en el límite, responde 200 y el archivo vuelve a contar para la cuota
```

---

## 5. Contrato de API

Ver `CONTRACTS.md` v0.5. `POST /api/files/:id/restore` → `200 { id, name, folderId }` | `404` | `409 FILE_NAME_CONFLICT` | `409 PARENT_FOLDER_UNAVAILABLE` | `422 STORAGE_QUOTA_EXCEEDED` (solo para archivos caducados, escenario 7).

---

## 6. Datos y Esquema

- **¿Modifica BD?** No. Debe dejar `is_deleted = false` **y** `deleted_at = NULL` a la vez: el CHECK `ck_file_soft_delete_consistent` exige `is_deleted = (deleted_at IS NOT NULL)`.
- No hay UNIQUE de nombre por carpeta en BD; la regla "mismo nombre = nueva versión" vive en `uploadMultipartFile`. Restaurar un archivo con un nombre ya ocupado crearía dos activos con el mismo nombre; por eso el 409.

---

## 7. Interfaz de Usuario

Pantalla en SPEC-205.

---

## 8. Diseño Técnico

- `FilesService.restoreFile(fileId, organizationId, userId)`: una transacción; buscar el archivo con `is_deleted = true` en el Drive del solicitante (mismo patrón de `softDelete`, bloqueo `pessimistic_write` de la fila); comprobar carpeta (`folder.is_deleted = false`); comprobar nombre activo duplicado `(organization_id, folder_id, name, is_deleted = false)`; actualizar.
- Todas las consultas con `organization_id = :orgId`. Sin tocar `tenant_quota`, salvo el bloqueo de `lockTenantQuota`.
- **Cuota (escenario 7):** un archivo con `deleted_at` anterior a 30 días ya no cuenta para la cuota (ADR-007 §7). Al restaurarlo vuelve a contar, así que se aplica la misma regla que la carga (`usado + reservado + tamaño de la versión vigente > límite del plan` → `422 STORAGE_QUOTA_EXCEEDED`). Un archivo dentro de la retención ya cuenta y no se vuelve a comprobar.
- **Auditoría:** `FILE_RESTORE` tras el commit (SPEC-405).
- **Riesgo:** carrera entre una subida del mismo nombre y la restauración: el bloqueo de la fila y la comprobación dentro de la misma transacción reducen la ventana; la subida ya serializa con `lockTenantQuota`.

---

## 9. Plan de Tareas

- [ ] **T1 (40 min)**: `restoreFile` con las tres comprobaciones.
- [ ] **T2 (15 min)**: ruta `POST /files/:id/restore`.
- [ ] **T3 (35 min)**: pruebas (escenarios 1–6).

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–6 | Unitaria | `modules/files/files.service.spec.ts` (o `files.trash.spec.ts`) |

---

## 11. Impacto en Documentación

- [x] `CONTRACTS.md` v0.5.

---

## 12. Preguntas Abiertas

Ninguna.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-27 | Revisión | Sin carpetas; acotado al Drive del solicitante; `FILE_NAME_CONFLICT`; CHECK de borrado lógico; respuesta `{ id, name, folderId }`. |
| 2026-10-31 | Revisión PR #34 | Escenario 6 corregido: solo aplica a archivos dentro de la retención. Añadido escenario 7 (`422 STORAGE_QUOTA_EXCEEDED` al restaurar un archivo caducado que no cabe en el plan). Opción A (comprobar cuota) aprobada en la revisión por Víctor Chán Morales. |
