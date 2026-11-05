# SPEC-223: PANTALLAS DE EQUIPOS

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/app/equipos/`, `apps/web/src/components/`, `apps/web/src/app/archivos/` |
| **Requisitos Vinculados** | RF-006 |
| **Dependencias** | SPEC-224 |
| **Prioridad** | P1 |
| **Estimación** | 3 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Administrar equipos y niveles, y cambiar entre "Mi espacio" y los Drives de equipo en el explorador.

## 3. Fuera de Alcance

- Cambios de API.
- Eliminar equipos.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Administrar
  Dado un tenant_admin en /equipos
  Entonces puede crear equipos, agregar miembros de la organización con su nivel,
  cambiar el nivel y quitarlos

Escenario 2: Colaborador
  Dado un colaborador en /equipos
  Entonces solo ve sus equipos y su nivel, sin acciones administrativas

Escenario 3: Cambiar de espacio
  Dado el explorador
  Entonces la barra lateral lista "Mi espacio" y los Drives de equipo
  Y al elegir uno muestra su contenido

Escenario 4: Solo lectura
  Dado un Drive con myLevel = read
  Entonces se ocultan subir, crear carpeta, enviar a la papelera y compartir
  Y una etiqueta indica "Solo lectura"

Escenario 5: Edición
  Dado un Drive con myLevel = write
  Entonces se ocultan solo las acciones de borrado definitivo

Escenario 6: Rechazo de la API
  Dado 403 DRIVE_PERMISSION_DENIED porque el nivel cambió
  Entonces muestra un mensaje y recarga el nivel

Escenario 7: Enlace directo
  Dado /archivos/<carpeta> de un Drive de equipo sin acceso (404)
  Entonces muestra "No encontramos esta carpeta"

Escenario 8: Papelera
  Dado /papelera
  Entonces permite elegir el Drive a consultar
```

## 5. Contrato de API

Consume SPEC-220 y SPEC-222: `/teams/*`, `GET /drives`, `?driveId`.

## 6. Datos y Esquema

No modifica la base de datos.

## 7. Interfaz de Usuario

- **Ruta nueva:** `/equipos`, y un elemento "Equipos" en `app-shell.tsx`.
- **Estados:** cargando, vacío ("Todavía no hay equipos"), error y datos.
- **Selector de miembros:** usa `GET /organizations/members`, disponible para `tenant_admin`.
- **Drive activo:** se obtiene de la respuesta de `GET /folders/:id/items` (`driveId`). En la raíz, parámetro `?drive=<id>`.

## 8. Diseño Técnico

- `lib/api/teams.ts` (nuevo) y `listDrives` en `lib/api/files.ts`.
- `getFolders`, `getTrash` aceptan `driveId` opcional.
- Pasar `myLevel` a las acciones del explorador. Ocultarlas es cortesía; la API autoriza.
- Dividir en `components/team-admin.tsx` y `components/drive-switcher.tsx`. `file-browser-live.tsx` solo los integra.

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: Clientes y tipos.
- [ ] **T2 (70 min)**: Pantalla `/equipos`.
- [ ] **T3 (60 min)**: Selector y acciones según nivel.
- [ ] **T4 (30 min)**: Papelera y prueba manual con tres cuentas.

**Archivos permitidos:** `app/equipos/page.tsx`, `components/team-admin.tsx`, `components/drive-switcher.tsx`, `lib/api/teams.ts` (nuevos), `components/file-browser-live.tsx`, `components/trash-view.tsx`, `components/app-shell.tsx`, `lib/api/files.ts`, `lib/api/types.ts`, `app/globals.css`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–8 | Manual con administrador, edición y lectura; `npm run lint:web` | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `docs/FIGMA_MAP.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
