# SPEC-218: NOMBRES DE CARPETA ÚNICOS

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (migración) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/`, `database/migrations/` |
| **Requisitos Vinculados** | RF-007, ADR-003 (Papelera y nombres) |
| **Dependencias** | SPEC-221 |
| **Prioridad** | P1 |
| **Estimación** | 1.5 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Impedir dos carpetas activas con el mismo nombre dentro de la misma carpeta, sin distinguir mayúsculas. `ADR-003` lo exige, pero hoy ni la API ni la base de datos lo validan.

## 3. Fuera de Alcance

- Renombrar y mover carpetas (SPEC-211, que aplica esta misma regla).
- Nombres de archivo: repetir uno crea una versión nueva (ADR-003).
- Limpiar o renombrar duplicados de forma automática.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Nombre repetido
  Dada una carpeta "Contratos" activa dentro de una carpeta
  Cuando envía POST /folders con "contratos" en esa misma carpeta
  Entonces responde 409 FOLDER_NAME_CONFLICT y no crea nada

Escenario 2: Espacios
  Dado el nombre "  Contratos  "
  Entonces se compara ya recortado y también responde 409

Escenario 3: Otra carpeta
  Dado el mismo nombre dentro de otra carpeta
  Entonces responde 201

Escenario 4: Papelera
  Dada una carpeta "Contratos" en la papelera
  Cuando crea otra "Contratos" en el mismo lugar
  Entonces responde 201
  Y restaurar la primera responde 409 FOLDER_NAME_CONFLICT, y sigue en la papelera

Escenario 5: Restaurar sin distinguir mayúsculas
  Dada una carpeta "CONTRATOS" activa y una "Contratos" en la papelera, en el mismo lugar
  Cuando restaura la segunda
  Entonces responde 409 FOLDER_NAME_CONFLICT

Escenario 6: Simultáneas
  Dadas dos solicitudes simultáneas con el mismo nombre
  Entonces una responde 201 y la otra 409 FOLDER_NAME_CONFLICT, nunca 500

Escenario 7: Pantalla
  Cuando crea una carpeta con un nombre ocupado en el explorador
  Entonces ve el mensaje de la API y el formulario sigue abierto
```

## 5. Contrato de API

`POST /folders` puede responder `409 FOLDER_NAME_CONFLICT`. El código ya existe. `POST /folders/:id/restore` lo aplica ahora sin distinguir mayúsculas.

## 6. Datos y Esquema

```sql
-- migrate:up
CREATE UNIQUE INDEX uq_folder_active_name_per_parent
  ON files.folder (parent_folder_id, lower(name))
  WHERE NOT is_deleted AND parent_folder_id IS NOT NULL;
-- migrate:down
DROP INDEX files.uq_folder_active_name_per_parent;
```

Las carpetas raíz quedan fuera del índice: no tienen padre y su Drive ya las limita a una.

**Bases con duplicados:** la migración falla y no modifica nada. No se renombran ni se borran carpetas de forma automática. Para encontrarlos antes de migrar:

```sql
SELECT parent_folder_id, lower(name), count(*)
FROM files.folder
WHERE NOT is_deleted AND parent_folder_id IS NOT NULL
GROUP BY 1, 2
HAVING count(*) > 1;
```

## 8. Diseño Técnico

- **`createFolder`:** dentro de la transacción y tras `lockTenantQuota`, buscar con `lower(name) = lower(:name)` en el mismo padre, entre las carpetas activas. Si existe, lanzar `FOLDER_NAME_CONFLICT` con `businessError`.
- **`restoreFolder`:** cambiar la comparación exacta de `nameTaken` por la misma búsqueda. Extraer una función privada para ambos casos.
- **Índice como red de seguridad:** capturar el error `23505` de `uq_folder_active_name_per_parent` y responder el mismo `409`.
- **Pantalla:** `createFolderSubmit` ya muestra el mensaje de la API y conserva el formulario, así que no cambia.
- **Riesgo:** SPEC-224 y SPEC-803 editan `createFolder`. Fusionar una y actualizar las demás.

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: Migración, subida y bajada.
- [ ] **T2 (30 min)**: Validación en `createFolder` y `restoreFolder`, y error `23505`.
- [ ] **T3 (40 min)**: Pruebas y documentos.

**Archivos permitidos:** la migración, `files/files.service.ts`, `files/files.service.spec.ts`, `files/files.folder-trash.spec.ts`, `CONTRACTS.md`, `docs/entregables/REQUISITOS_CASOS_USO.md`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–5 | Unitaria | `files.service.spec.ts`, `files.folder-trash.spec.ts` |
| Escenario 6 | Unitaria con error `23505` simulado | `files.service.spec.ts` |
| Migración y escenario 6 real | Manual con Postgres | Evidencia en el PR |
| Escenario 7 | Manual | Captura en el PR |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6.
- [ ] `docs/entregables/REQUISITOS_CASOS_USO.md`: quitar la brecha de UC-12 y el riesgo 6.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial, pedida por el coordinador. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
