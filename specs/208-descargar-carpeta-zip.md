# SPEC-208: DESCARGAR CARPETA EN ZIP

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (requiere una librería y consume memoria) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/` |
| **Requisitos Vinculados** | Usabilidad; la propuesta no lo exige |
| **Dependencias** | SPEC-221 |
| **Prioridad** | P3 |
| **Estimación** | 2 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Bajar una carpeta completa en un único archivo.

## 3. Fuera de Alcance

- Carpetas de más de 500 MB o 500 archivos; se rechazan.
- Zip cifrado.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Descarga
  Cuando envía GET /folders/:id/download
  Entonces recibe un ZIP con las versiones vigentes de los archivos activos y su estructura de carpetas

Escenario 2: Límite → 422 FOLDER_TOO_LARGE_FOR_ZIP

Escenario 3: Nombres peligrosos
  Entonces ninguna entrada contiene ".." ni rutas absolutas

Escenario 4: Fallo a mitad
  Dado un error al leer un objeto
  Entonces la conexión se aborta y el ZIP no parece completo

Escenario 5: Aislamiento → 404 con una carpeta ajena

Escenario 6: Auditoría → FOLDER_DOWNLOAD
```

## 5. Contrato de API

`GET /folders/:id/download` → `application/zip`.

## 6. Datos y Esquema

Sin migración.

## 8. Diseño Técnico

- **Requiere aprobar una librería de ZIP mediante ADR** (REGLAS §1 y ADR-008 §12). Sin esa aprobación, esta spec no se inicia.
- Procesar un archivo a la vez, y escribir en la respuesta con contrapresión para no acumular la carpeta en memoria.

## 9. Plan de Tareas

- [ ] **T1 (15 min)**: ADR de la librería.
- [ ] **T2 (60 min)**: Servicio y ruta.
- [ ] **T3 (45 min)**: Pruebas y botón.

**Archivos permitidos:** `files/folder-zip.service.ts` y su spec (nuevos), `files/files.controller.ts`, `files/files.module.ts`, `apps/api/package.json`, `audit/audit.types.ts`, `components/file-browser-live.tsx`, `lib/api/files.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–6 | Unitaria | `folder-zip.service.spec.ts` |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
