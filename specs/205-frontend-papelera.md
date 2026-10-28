# SPEC-205: PANTALLA DE PAPELERA Y ACCIÓN "MOVER A PAPELERA"

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 (Frontend / Integración) |
| **Responsable Principal** | Miguel (dueño de Files; acuerdo con Víctor, CONTRIBUTING.md) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/app/papelera/`, `apps/web/src/components/` (nuevo `trash-view.tsx`), `apps/web/src/components/file-browser-live.tsx`, `apps/web/src/lib/api/files.ts` |
| **Requisitos Vinculados** | RF-009 |
| **Dependencias** | SPEC-202 y 203 (API). Purga: SPEC-204 (P2). Puede avanzar con un mock del contrato v0.5. |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) — **prioridad P2** (ver `specs/README.md`) |
| **Estimación** | 2.0 h |
| **Estado** | En revisión (reescrita 2026-10-27 según ADR-007) |

---

## 2. Objetivo

Reemplazar el aviso de `/papelera` por una pantalla real (listar, restaurar, eliminar definitivamente) y **añadir al explorador la acción "Mover a papelera"**: hoy el explorador solo ofrece "Descargar", por lo que desde la interfaz no hay cómo mandar nada a la papelera.

---

## 3. Fuera de Alcance (YAGNI)

- Selección múltiple y "vaciar papelera".
- Papelera de carpetas.
- Ver la papelera de otros miembros.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Mover a papelera desde el explorador
  Dado un archivo en /archivos
  Cuando el usuario elige "Mover a papelera"
  Entonces se llama DELETE /api/files/:id, el archivo desaparece de la lista
  Y se informa "Archivo movido a la papelera" con un enlace a /papelera

Escenario 2: Listar la papelera
  Dado que el usuario abre /papelera
  Entonces ve nombre, tamaño (formatBytes), fecha de eliminación y "Se conserva hasta {retentionEndsAt}" (formatIsoDate)
  Y un aviso: "Los archivos en la papelera cuentan para tu almacenamiento durante 30 días desde que los eliminaste"

Escenario 3: Restaurar
  Cuando pulsa "Restaurar", el elemento desaparece de la tabla
  Y si la API responde 409 FILE_NAME_CONFLICT muestra "Ya existe un archivo con ese nombre en la carpeta"

Escenario 4: Eliminar definitivamente (si SPEC-204 está disponible)
  Cuando pulsa "Eliminar definitivamente" y confirma en el diálogo ("Esta acción no se puede deshacer")
  Entonces se llama DELETE /api/files/:id/purge y la lista se actualiza

Escenario 5: Estados
  Entonces existen cargando, vacío ("La papelera está vacía"), error con reintento y datos
```

---

## 5. Contrato de API

Consume `CONTRACTS.md` v0.5 ("Papelera y versiones") y `DELETE /files/:id` (v0.4 implícito). Funciones `getTrash()`, `restoreFile(id)`, `purgeFile(id)` y `deleteFile(id)` en `lib/api/files.ts`.

---

## 6. Datos y Esquema

No aplica.

---

## 7. Interfaz de Usuario

- Ruta `/papelera` (existe). Nuevo componente `TrashView`; se elimina la rama `trash` de `FileBrowserLive` y su aviso.
- Fechas con `formatIsoDate()` y tamaños con `formatBytes()` de `lib/format.ts` (no helpers nuevos).

---

## 8. Diseño Técnico

- `RequireSession` + `useLoad`, igual que el explorador.
- El botón "Eliminar definitivamente" se muestra a quien sea dueño (siempre, en este corte). Sin lógica de permisos ni cuota en el cliente.

---

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: cliente API (cuatro funciones) y tipos.
- [ ] **T2 (20 min)**: acción "Mover a papelera" en el explorador (fila y panel de detalle).
- [ ] **T3 (45 min)**: `TrashView` con estados, restaurar y mapeo de errores.
- [ ] **T4 (25 min)**: confirmación modal y purga (cuando 204 esté disponible).
- [ ] **T5 (10 min)**: retirar la rama `trash` de `FileBrowserLive`.

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Verificación |
|---|---|---|
| Escenarios 1–5 | Manual | Recorrido: subir → mover a papelera → ver en papelera → restaurar → comprobar que reaparece; repetir y purgar; verificar la cuota en el panel |

---

## 11. Impacto en Documentación

- [ ] `docs/FIGMA_MAP.md`: pantalla de papelera.

---

## 12. Preguntas Abiertas

Ninguna.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-27 | Revisión | Añadida la acción "Mover a papelera" (sin ella la papelera nunca recibe archivos desde la UI); sin carpetas; aviso de cuota; `formatBytes`/`formatIsoDate`. |
