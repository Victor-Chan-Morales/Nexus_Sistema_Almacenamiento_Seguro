# SPEC-213: BÚSQUEDA GLOBAL POR NOMBRE

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/`, `apps/web/src/components/file-browser-live.tsx` |
| **Requisitos Vinculados** | RF-007 |
| **Dependencias** | SPEC-221 |
| **Prioridad** | P2 |
| **Estimación** | 1.5 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Buscar archivos y carpetas en todo un Drive. Hoy el buscador solo filtra la carpeta abierta en el navegador.

## 3. Fuera de Alcance

- Buscar dentro del contenido: los archivos están cifrados.
- Filtros por tipo o fecha.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Coincidencias
  Cuando envía GET /files/search?q=infor
  Entonces recibe archivos y carpetas activos cuyo nombre contiene el texto, sin distinguir mayúsculas
  Con la ruta de carpeta de cada uno

Escenario 2: Caracteres especiales
  Dado q con % o _ → se buscan literalmente

Escenario 3: Longitud
  Dado q de menos de 2 o más de 100 caracteres → 400 VALIDATION_ERROR

Escenario 4: Límite → máximo 50 resultados

Escenario 5: Aislamiento
  Entonces solo devuelve elementos del Drive accesible indicado, y excluye la papelera

Escenario 6: Pantalla
  Cuando escribe en el buscador
  Entonces, tras una pausa de 300 ms, muestra los resultados con su ubicación
  Y cancela la solicitud anterior
```

## 5. Contrato de API

`GET /files/search?q&driveId?` → `{ items: [{ kind, id, name, folderId, path, mimeType?, sizeBytes? }] }`.

## 6. Datos y Esquema

Sin migración. Índice `pg_trgm` fuera de alcance salvo problema medido.

## 8. Diseño Técnico

`FileSearchService`; `ILIKE` parametrizado con escape. **`GET /files/search` se declara antes de las rutas con `:id`.** Ruta con CTE recursiva limitada a los resultados.

## 9. Plan de Tareas

- [ ] **T1 (45 min)**: Servicio y ruta.
- [ ] **T2 (25 min)**: Pantalla.
- [ ] **T3 (20 min)**: Pruebas.

**Archivos permitidos:** `files/file-search.service.ts` y su spec (nuevos), `files/files.controller.ts`, `files/files.module.ts`, `components/file-browser-live.tsx`, `lib/api/files.ts`, `lib/api/types.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–5 | Unitaria | `file-search.service.spec.ts` |
| Escenario 6 | Manual | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
