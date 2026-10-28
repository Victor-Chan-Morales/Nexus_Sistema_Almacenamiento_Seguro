# SPEC-207: HISTORIAL DE VERSIONES EN EL EXPLORADOR

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 (Frontend / Integración) |
| **Responsable Principal** | Miguel (dueño de Files; acuerdo con Víctor, CONTRIBUTING.md) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/components/file-browser-live.tsx`, `apps/web/src/components/file-versions-modal.tsx` (nuevo), `apps/web/src/lib/api/files.ts` |
| **Requisitos Vinculados** | RF-008 (parcial) |
| **Dependencias** | SPEC-206 (API). Puede avanzar con un mock. |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) — **prioridad P2** |
| **Estimación** | 1.5 h |
| **Estado** | En revisión (reescrita 2026-10-27 según ADR-007) |

---

## 2. Objetivo

Añadir una acción "Versiones" a cada archivo del explorador que abra un modal de solo lectura con su historial.

---

## 3. Fuera de Alcance (YAGNI)

- Descargar o restaurar una versión anterior (ver SPEC-206).
- Comparar versiones.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Ver versiones
  Dado un archivo en el explorador
  Cuando el usuario pulsa "Versiones" (acción de la fila o del panel de detalle)
  Entonces se abre un modal que consulta GET /api/files/:id/versions
  Y lista versión ("v3"), tamaño (formatBytes), fecha (formatIsoDate) e indica cuál es la actual

Escenario 2: Una sola versión
  Entonces muestra la versión única con la leyenda "Aún no hay versiones anteriores"

Escenario 3: Estados
  Entonces existen cargando, error con reintento y datos; el modal se cierra con Escape y con el botón
```

---

## 5. Contrato de API

Consume `CONTRACTS.md` v0.5 (`GET /files/:id/versions`). `getFileVersions(fileId)` en `lib/api/files.ts`.

---

## 6. Datos y Esquema

No aplica.

---

## 7. Interfaz de Usuario

- El explorador no tiene menú "..." (solo la acción "Descargar" por fila y un panel de detalle al seleccionar): el botón "Versiones" se añade a esas dos zonas.
- Modal accesible (`role="dialog"`, foco atrapado, `aria-label`).

---

## 8. Diseño Técnico

- Componente `FileVersionsModal({ file, token, onClose })`; carga con `useLoad`. Sin cálculo de negocio en el cliente.

---

## 9. Plan de Tareas

- [ ] **T1 (15 min)**: `getFileVersions` y tipos.
- [ ] **T2 (45 min)**: `FileVersionsModal` con estados y accesibilidad.
- [ ] **T3 (30 min)**: botón "Versiones" en fila y panel de detalle de `FileBrowserLive`.

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Verificación |
|---|---|---|
| Escenarios 1–3 | Manual | Subir el mismo archivo 3 veces y comprobar v3, v2, v1 |

---

## 11. Impacto en Documentación

Ninguno.

---

## 12. Preguntas Abiertas

Ninguna.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-27 | Revisión | Sin menú "..." (no existe): botón en fila y panel; solo lectura; prioridad P2. |
