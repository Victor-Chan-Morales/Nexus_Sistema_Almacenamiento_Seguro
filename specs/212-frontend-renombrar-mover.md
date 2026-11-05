# SPEC-212: RENOMBRAR Y MOVER (PANTALLA)

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/components/` |
| **Requisitos Vinculados** | RF-007 |
| **Dependencias** | SPEC-211 |
| **Prioridad** | P2 |
| **Estimación** | 2 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Agregar "Renombrar" y "Mover a…" al explorador.

## 3. Fuera de Alcance

- Mover arrastrando.
- Selección múltiple.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Renombrar
  Cuando confirma un nombre nuevo
  Entonces la fila se actualiza

Escenario 2: Mover
  Cuando elige una carpeta en el selector y confirma
  Entonces el elemento desaparece de la carpeta actual

Escenario 3: Destinos no válidos
  Entonces el selector deshabilita la carpeta actual, sus descendientes y las de otro almacén

Escenario 4: Errores
  Dados los códigos de SPEC-211 → mensajes en español, sin cambios en la fila

Escenario 5: Solo lectura
  Dado nivel read → no aparecen las acciones
```

## 5. Contrato de API

Consume SPEC-211.

## 6. Datos y Esquema

No modifica la base de datos.

## 7. Interfaz de Usuario

Diálogos con `Dialog`. Selector en árbol a partir de `GET /folders`. Estados de proceso y error.

## 8. Diseño Técnico

`lib/api/files.ts`: `updateFile`, `updateFolder`. `components/move-dialog.tsx` y `components/rename-dialog.tsx`.

## 9. Plan de Tareas

- [ ] **T1 (45 min)**: Renombrar.
- [ ] **T2 (60 min)**: Mover.
- [ ] **T3 (15 min)**: Prueba manual.

**Archivos permitidos:** `components/move-dialog.tsx`, `components/rename-dialog.tsx` (nuevos), `components/file-browser-live.tsx`, `lib/api/files.ts`, `lib/api/types.ts`, `app/globals.css`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–5 | Manual; `npm run lint:web` | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `docs/FIGMA_MAP.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
