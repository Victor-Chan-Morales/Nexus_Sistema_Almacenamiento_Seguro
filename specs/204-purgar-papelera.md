# SPEC-204: PURGA DEFINITIVA DE UN ARCHIVO DE LA PAPELERA

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (borrado físico irreversible y liberación de cuota) |
| **Responsable Principal** | Miguel (Dominio Files & Storage) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/` (usa `modules/storage/` sin modificarlo) |
| **Requisitos Vinculados** | RF-009, RF-013 |
| **Dependencias** | Ninguna (el evento de auditoría va en SPEC-405) |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) — **prioridad P2** (ver `specs/README.md`) |
| **Estimación** | 2.0 h |
| **Estado** | En revisión (reescrita 2026-10-27 según ADR-007) |

---

## 2. Objetivo

`DELETE /api/files/:id/purge` elimina de forma definitiva un archivo de la papelera del solicitante: sus versiones, sus metadatos y sus objetos en SeaweedFS, y libera la cuota.

**Enmienda a ADR-003 (ADR-007 §7):** puede ejecutarla el dueño del archivo; no se limita a administradores.

---

## 3. Fuera de Alcance (YAGNI)

- Purga masiva ("vaciar papelera") y purga automática a los 30 días.
- Purgar carpetas.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Purga exitosa
  Dado un archivo propio en la papelera con 3 versiones (10 MB, 8 MB y 5 MB)
  Cuando envía DELETE /api/files/:id/purge
  Entonces responde 200 con { id, freedBytes: 23000000 }
  Y no quedan filas en files.file ni files.file_version para ese archivo
  Y los contadores de files.tenant_quota se reescriben sin esos bytes
  Y se intenta borrar de SeaweedFS el objeto de cada versión

Escenario 2: Archivo activo
  Dado un archivo propio que NO está en la papelera
  Entonces responde 422 CANNOT_PURGE_ACTIVE_FILE y no cambia nada

Escenario 3: Ajeno o inexistente
  Dado un id de otra organización, de otro miembro, o inexistente
  Entonces responde 404

Escenario 4: Falla el borrado en SeaweedFS
  Dado que SeaweedFS no responde al borrar un objeto
  Entonces la purga sigue siendo exitosa (los metadatos ya se eliminaron)
  Y el objeto huérfano se registra en el log (clave de objeto, sin contenido)

Escenario 5: Falla la base de datos
  Dado que la transacción falla
  Entonces NO se borra ningún objeto de SeaweedFS y el archivo sigue en la papelera
```

---

## 5. Contrato de API

Ver `CONTRACTS.md` v0.5. `DELETE /api/files/:id/purge` → `200 { id, freedBytes }` | `404` | `422 CANNOT_PURGE_ACTIVE_FILE`.

---

## 6. Datos y Esquema

- **¿Modifica BD?** No, pero hay que respetar las FK, todas `RESTRICT`:
  - `files.file (file_id, current_version_id)` → `files.file_version` (RESTRICT).
  - `files.file_version.file_id` → `files.file` (RESTRICT).
  - `files.share_link` y la ACL se eliminan en cascada con el archivo.
- Orden obligatorio dentro de la transacción: (1) `UPDATE files.file SET current_version_id = NULL`; (2) `DELETE` de las versiones; (3) `DELETE` del archivo. Antes de implementar, comprobar en `20260928090800_add_foreign_keys.sql` si `files.upload` o `files.reservation` referencian el archivo o la versión.

---

## 7. Interfaz de Usuario

Pantalla en SPEC-205 (con confirmación modal).

---

## 8. Diseño Técnico

- `FilesService.purgeFile(fileId, organizationId, userId): Promise<{ id: string; freedBytes: number }>`.
- **Transacción:** `lockTenantQuota` → localizar el archivo en el Drive del solicitante (cualquier estado): no existe → `404`; `is_deleted = false` → `422` → leer versiones (`object_key`, `size_bytes`) → pasos (1)–(3) → `readStorageUsage` + `writeQuotaCounters`. `freedBytes` = suma de **todas** las versiones.
- **Objetos de SeaweedFS:** se borran **después del commit**, uno por uno y con mejor esfuerzo (`Promise.allSettled`); un fallo se registra con `Logger` (clave del objeto) y no revierte nada. Es preferible un objeto huérfano a metadatos que apunten a bytes inexistentes (mismo criterio que la compensación de la subida).
- **Auditoría:** `FILE_PURGE` tras el commit (SPEC-405). Nunca registrar el nombre ni el contenido.
- **Riesgos:** (a) borrar objetos antes del commit y que falle la BD → corrupción (por eso el orden); (b) FK `RESTRICT` mal ordenadas → error 23503 (cubierto por prueba); (c) la cuota tiene que reescribirse en la misma transacción para no dejar contadores obsoletos.

---

## 9. Plan de Tareas

- [ ] **T1 (50 min)**: `purgeFile` (transacción, orden de borrado, cuota).
- [ ] **T2 (25 min)**: borrado de objetos post-commit con `allSettled` y registro de huérfanos.
- [ ] **T3 (15 min)**: ruta `DELETE /files/:id/purge`.
- [ ] **T4 (30 min)**: pruebas (escenarios 1–5, incluida la FK).

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–5 | Unitaria | `modules/files/files.service.spec.ts` (o `files.trash.spec.ts`) |
| Orden de FK y reescritura de cuota | Integración contra Postgres (manual en el recorrido de la demo) | — |

---

## 11. Impacto en Documentación

- [x] `CONTRACTS.md` v0.5; enmienda en ADR-003.

---

## 12. Preguntas Abiertas

Ninguna.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-27 | Revisión | Orden de borrado según las FK `RESTRICT`; objetos borrados después del commit; purga por el dueño (enmienda ADR-003); sin carpetas; `freedBytes` = todas las versiones; prioridad P2. |
