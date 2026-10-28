# SPEC-206: HISTORIAL DE VERSIONES DE UN ARCHIVO

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 |
| **Responsable Principal** | Miguel (Dominio Files & Storage) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/` |
| **Requisitos Vinculados** | RF-008 (parcial: solo lectura) |
| **Dependencias** | Ninguna |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) — **prioridad P2** |
| **Estimación** | 1.0 h |
| **Estado** | En revisión (reescrita 2026-10-27 según ADR-007) |

---

## 2. Objetivo

`GET /api/files/:id/versions` lista las versiones de un archivo propio (la subida repetida del mismo nombre ya crea versiones). Hoy el dato existe en BD pero no se puede consultar.

---

## 3. Fuera de Alcance (YAGNI)

- Descargar o **restaurar** una versión anterior: el historial es de solo lectura en este corte. RF-008 queda parcial y se declara así.
- Mostrar quién subió cada versión (en un Drive personal siempre es el dueño).
- Exponer el checksum.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Archivo con varias versiones
  Dado un archivo propio subido 3 veces con el mismo nombre en la misma carpeta
  Cuando envía GET /api/files/:id/versions
  Entonces responde 200 con 3 versiones ordenadas de la más reciente a la más antigua
  Y cada una incluye versionId, versionNumber, sizeBytes, uploadedAt e isCurrent
  Y currentVersion es el número de la versión actual

Escenario 2: Ajeno, de otra organización, inexistente o eliminado
  Entonces responde 404

Escenario 3: Sin datos sensibles
  Entonces la respuesta no incluye object_key, encrypted_dek, kek_id ni checksum
```

---

## 5. Contrato de API

Ver `CONTRACTS.md` v0.5. `GET /api/files/:id/versions` → `{ fileId, fileName, currentVersion, versions: [{ versionId, versionNumber, sizeBytes, uploadedAt, isCurrent }] }`. Los nombres de campo siguen el contrato de Files (`versionId`, `uploadedAt`), no `id`/`createdAt`.

---

## 6. Datos y Esquema

- **¿Modifica BD?** No. `files.file_version` filtrada por `file_id`, con el archivo validado por `organization_id` y Drive del solicitante; orden `version_number DESC`.

---

## 7. Interfaz de Usuario

Modal en SPEC-207.

---

## 8. Diseño Técnico

- `FilesService.listVersions(fileId, organizationId, userId)`: mismo patrón de acotado que `downloadFileStream` (Drive propio, archivo activo).
- DTO propio; `sizeBytes` como número. Sin auditoría (lectura).

---

## 9. Plan de Tareas

- [ ] **T1 (30 min)**: `listVersions` y DTO.
- [ ] **T2 (10 min)**: ruta `GET /files/:id/versions`.
- [ ] **T3 (20 min)**: pruebas (escenarios 1–3).

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–3 | Unitaria | `modules/files/files.service.spec.ts` |

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
| 2026-10-27 | Revisión | Campos del contrato (`versionId`, `uploadedAt`); acotado al Drive propio; sin checksum; aclarado que no incluye restauración de versión (el backlog lo prometía). |
