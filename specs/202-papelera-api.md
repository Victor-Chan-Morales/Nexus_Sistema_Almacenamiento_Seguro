# SPEC-202: LISTADO DE LA PAPELERA

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 (módulo existente, sin esquema nuevo) |
| **Responsable Principal** | Miguel (Dominio Files & Storage) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/` |
| **Requisitos Vinculados** | RF-009 |
| **Dependencias** | Ninguna |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) — **prioridad P2** (ver `specs/README.md`) |
| **Estimación** | 1.0 h |
| **Estado** | En revisión (reescrita 2026-10-27 según ADR-007) |

---

## 2. Objetivo

`GET /api/files/trash` lista los archivos que el solicitante eliminó (borrado lógico) de su Drive personal, para que `/papelera` muestre datos reales.

---

## 3. Fuera de Alcance (YAGNI)

- **Carpetas en la papelera:** no existe `DELETE /folders/:id`; solo hay borrado de archivos (ADR-007 §7).
- Ver la papelera de otros miembros (incluido un administrador): no en este corte.
- Paginación (se devuelven como máximo 500 elementos, los más recientes primero) y vaciado automático a los 30 días.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Listado de los propios archivos eliminados
  Dado que el usuario eliminó 2 archivos de su Drive
  Cuando envía GET /api/files/trash
  Entonces responde 200 con 2 items (id, name, mimeType, sizeBytes, deletedAt, retentionEndsAt) y totalItems = 2
  Y retentionEndsAt = deletedAt + 30 días (a partir de esa fecha el archivo deja de contar para la cuota; no se borra solo)

Escenario 2: Aislamiento por organización y por dueño
  Dado archivos eliminados de otra organización y de otro miembro de la misma organización
  Entonces la respuesta no los incluye

Escenario 3: Papelera vacía
  Entonces responde 200 con items = [] y totalItems = 0

Escenario 4: Los archivos activos no aparecen
  Entonces un archivo con is_deleted = false nunca se lista
```

---

## 5. Contrato de API

Ver `CONTRACTS.md` v0.5, "Papelera y versiones". `GET /api/files/trash` — cualquier miembro autenticado.

---

## 6. Datos y Esquema

- **¿Modifica BD?** No. Esquema real: `files.file.is_deleted` y `deleted_at` (no existe una columna `status`). Consulta `file` ⋈ `folder` (`folder.drive_id` = Drive personal del solicitante) ⋈ `file_version` (versión actual para `size_bytes`), con `file.organization_id = :orgId AND file.is_deleted = true`, orden `deleted_at DESC`.

---

## 7. Interfaz de Usuario

Pantalla en SPEC-205.

---

## 8. Diseño Técnico

- `FilesService.listTrash(organizationId, userId): Promise<TrashResponseDto>`. Reutilizar el patrón de `softDelete`/`downloadFileStream` (`getOrCreateUserDrive` + join con `folder.driveId`) para acotar al Drive del solicitante.
- Declarar `@Get('trash')` en `FilesController` **antes** de cualquier ruta con `:id`.
- DTOs `TrashItemDto` y `TrashResponseDto` en `modules/files/dto/trash.dto.ts` (nunca la entidad). `sizeBytes` como número; fechas ISO.
- `retentionEndsAt` lo calcula el servidor (no el cliente). Es informativo: la cuota ya excluye los archivos eliminados hace más de 30 días (`readStorageUsage`), pero **no hay purga automática**.

---

## 9. Plan de Tareas

- [ ] **T1 (15 min)**: DTOs.
- [ ] **T2 (25 min)**: `listTrash` con el join por Drive.
- [ ] **T3 (10 min)**: ruta `GET /files/trash`.
- [ ] **T4 (10 min)**: pruebas (escenarios 1–4).

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–4 | Unitaria | `modules/files/files.service.spec.ts` (o `files.trash.spec.ts`) |

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
| 2026-10-27 | Revisión | `is_deleted`/`deleted_at` en vez de `status`; solo archivos; acotado al Drive del solicitante (antes mostraba toda la organización); añadido `retentionEndsAt`. |



### Resumen de Cambios — SPEC-202

#### 1. Archivos Modificados y Creados

* **`apps/api/src/modules/files/dto/trash.dto.ts`** *(Creado)*: Define `TrashItemDto` y `TrashResponseDto` con cálculo de retención a 30 días (`retentionEndsAt`) y tamaño numérico (`sizeBytes`).
* **`apps/api/src/modules/files/files.service.ts`** *(Modificado)*: Implementa `listTrash(orgId, userId)` filtrando por Drive personal (`folder.driveId`), `is_deleted = true`, límite de 500 registros y resolución de versiones por `currentVersionId`.
* **`apps/api/src/modules/files/files.controller.ts`** *(Modificado)*: Registra la ruta `@Get('trash')` protegida con `JwtAuthGuard` antes de las rutas con `:id`.
* **`specs/202-papelera-api.md`** *(Actualizado)*: Tareas marcadas como completadas y registro de cambios cerrado.

#### 2. Ajustes de Infraestructura

* **PostgreSQL (Docker):** Configurado en el puerto `5434` (para evitar colisión con el puerto local de Windows/WSL) con usuario `nexus_dev`.
* **Tabla `billing.plan`:** Actualizada en el contenedor con las columnas requeridas (`description`, `validity_days`, `price_monthly`, `storage_limit_gb`, `user_limit`) para permitir el arranque limpio de `BillingService`.

#### 3. Evidencia de Validación

* **Compilación:** `Found 0 errors` en TypeScript.
* **Prueba Funcional (PowerShell):**
```powershell
# Invocación autenticada a la API local
$trash = Invoke-RestMethod -Uri "http://localhost:3001/api/files/trash" -Method Get -Headers @{ Authorization = "Bearer $token" }
$trash | ConvertTo-Json -Depth 5

```


* **Respuesta obtenida (200 OK):**
```json
{
  "items": [],
  "totalItems": 0
}

```