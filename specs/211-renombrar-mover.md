# SPEC-211: RENOMBRAR Y MOVER (BACKEND)

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (concurrencia sobre el árbol) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/` |
| **Requisitos Vinculados** | RF-007 |
| **Dependencias** | SPEC-221, SPEC-224 (el escenario 8 usa sus niveles) |
| **Prioridad** | P2 |
| **Estimación** | 3 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Cambiar el nombre o la carpeta de archivos y carpetas dentro del mismo Drive.

## 3. Fuera de Alcance

- Mover entre Drives o entre almacenes distintos.
- Copiar.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Renombrar archivo o carpeta → 200 con el nombre nuevo

Escenario 2: Mover archivo o carpeta
  Entonces cambia de carpeta contenedora y conserva versiones y enlaces

Escenario 3: Nombre ocupado → 409 FILE_NAME_CONFLICT o FOLDER_NAME_CONFLICT

Escenario 4: Ciclo
  Cuando mueve una carpeta dentro de sí misma o de una descendiente
  Entonces responde 422 FOLDER_CYCLE_NOT_ALLOWED

Escenario 5: Otro almacén
  Dado un destino diferente → 422 DESTINATION_MISMATCH

Escenario 6: Otro Drive o ajeno → 404

Escenario 7: Raíz o papelera
  Dada la raíz del Drive o un elemento en papelera → 422 RESOURCE_NOT_MOVABLE

Escenario 8: Permisos
  Dado nivel read → 403 DRIVE_PERMISSION_DENIED

Escenario 9: Nombre inválido → 400 VALIDATION_ERROR
  Y se reutiliza la normalización de nombres de la subida

Escenario 10: Auditoría
  Entonces registra FILE_RENAMED, FILE_MOVED, FOLDER_RENAMED o FOLDER_MOVED, sin nombres
```

## 5. Contrato de API

`PATCH /files/:id` y `PATCH /folders/:id` con `{ name?, parentId? }` (al menos uno; `folderId` en archivos) → `200` con la misma forma de cada listado.

## 6. Datos y Esquema

Sin migración.

## 8. Diseño Técnico

- `FileOrganizerService` nuevo.
- **Ciclo:** consulta recursiva, dentro de una transacción con bloqueo de las filas de carpeta en orden por id, para evitar interbloqueos.
- **Destino efectivo** comparado entre origen y destino.
- **Renombrar archivos:** el mismo nombre en una carpeta crea versiones (ADR-003); por eso no debe quedar duplicado.

## 9. Plan de Tareas

- [ ] **T1 (60 min)**: Renombrar y validaciones.
- [ ] **T2 (60 min)**: Mover y ciclos.
- [ ] **T3 (60 min)**: Pruebas.

**Archivos permitidos:** `files/file-organizer.service.ts`, `files/dto/organize.dto.ts`, su spec (nuevos), `files/files.controller.ts`, `files/files.module.ts`, `audit/audit.types.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–10 | Unitaria | `file-organizer.service.spec.ts` |
| Movimientos cruzados simultáneos | E2E con Postgres | `apps/api/test/` |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
| 2026-11-04 | Claude Code (revisión) | SPEC-224 pasa a ser dependencia firme: el escenario 8 usa sus niveles. Aprobado por el coordinador (2026-11-04). |
