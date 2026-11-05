# SPEC-109: ADMINISTRAR MIEMBROS (PANTALLA)

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/app/configuracion/`, `apps/web/src/lib/api/` |
| **Requisitos Vinculados** | RF-003 |
| **Dependencias** | SPEC-108 |
| **Prioridad** | P1 |
| **Estimación** | 1.5 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Agregar a la lista de miembros de `/configuracion` las acciones de cambiar rol, suspender, reactivar y eliminar.

## 3. Fuera de Alcance

- Cualquier cambio de API.
- Búsqueda o paginación de miembros.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Administrador
  Dado un tenant_admin
  Entonces cada fila de otro miembro ofrece cambiar rol, suspender o reactivar, y eliminar
  Y su propia fila no ofrece suspender ni eliminar

Escenario 2: Colaborador
  Dado un colaborador
  Entonces no ve estas acciones

Escenario 3: Confirmación
  Cuando pulsa suspender o eliminar
  Entonces un diálogo explica las consecuencias antes de ejecutar
  Y eliminar indica que los archivos se conservan y que la persona pierde el acceso

Escenario 4: Éxito
  Cuando la operación termina
  Entonces la lista se recarga con el estado nuevo

Escenario 5: Errores
  Dado LAST_ADMIN_REQUIRED, CANNOT_MODIFY_SELF, USER_LIMIT_EXCEEDED o un error de red
  Entonces muestra un mensaje en español y la fila no cambia
```

## 5. Contrato de API

Consume SPEC-108: `PATCH` y `DELETE /organizations/members/:id`.

## 6. Datos y Esquema

No modifica la base de datos.

## 7. Interfaz de Usuario

- **Ruta:** `/configuracion`. Reutilizar `Dialog` y `Notice`.
- **Estados:** en proceso (botones deshabilitados), error y datos. Vacío y carga ya existen.
- **Accesibilidad:** botones con `aria-label` que incluya el nombre.

## 8. Diseño Técnico

- `lib/api/members.ts`: `updateMember(id, input, accessToken)` y `removeMember(id, accessToken)`.
- Extraer la fila a `components/member-row.tsx`: `configuracion/page.tsx` ya tiene 287 líneas.
- Ocultar por rol es solo cortesía; quien autoriza es la API.

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: Cliente y tipos.
- [ ] **T2 (50 min)**: Fila, menú y diálogos.
- [ ] **T3 (20 min)**: Mensajes de error y prueba manual.

**Archivos permitidos:** `app/configuracion/page.tsx`, `components/member-row.tsx` (nuevo), `lib/api/members.ts`, `lib/api/types.ts`, `app/globals.css`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–5 | Manual con la API y `npm run lint:web` | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `docs/FIGMA_MAP.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
