# SPEC-502: PANEL SUPER ADMIN CON DATOS REALES

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/app/dashboard/super-admin/`, `apps/web/src/components/` |
| **Requisitos Vinculados** | RF-016 |
| **Dependencias** | SPEC-501, SPEC-503 |
| **Prioridad** | P1 |
| **Estimación** | 2 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Sustituir la maqueta con cifras inventadas por datos reales, y bloquear la pantalla a quien no sea Super Admin.

## 3. Fuera de Alcance

- Editar planes (SPEC-504).
- Gráficas o historial de actividad global.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Acceso
  Dado un usuario sin isSuperAdmin
  Cuando abre /dashboard/super-admin
  Entonces se redirige a /dashboard, sin mostrar contenido

Escenario 2: Menú
  Dado un Super Admin
  Entonces ve el enlace a la consola, que los demás no ven

Escenario 3: Métricas y organizaciones
  Entonces ve totales, y una tabla con estado, plan, uso, miembros y modelo
  Y no queda ningún dato de ejemplo ni la leyenda de maqueta

Escenario 4: Suspender y reactivar
  Cuando suspende una organización, con confirmación
  Entonces la fila se actualiza

Escenario 5: Instalaciones
  Entonces ve solicitudes pendientes y puede aprobar, indicando operador, o rechazar
  Y puede avanzar el estado de cada instalación

Escenario 6: Errores
  Dado 403, 409, 422 o error de red
  Entonces muestra un mensaje en español y permite reintentar
```

## 5. Contrato de API

Consume SPEC-501 y SPEC-503: `/platform/*`.

## 6. Datos y Esquema

No modifica la base de datos.

## 7. Interfaz de Usuario

- Reescribir `SuperAdminDashboard` en un componente nuevo; quitar el `demo` de `AppShell`.
- **Estados:** cargando, vacío ("No hay solicitudes pendientes"), error y datos.
- Tabla con paginación simple. Bytes formateados con `formatBytes`.

## 8. Diseño Técnico

- `lib/api/platform.ts` (nuevo). `Session` incluye `isSuperAdmin`.
- `adminNavigation` en `app-shell.tsx` apunta a secciones reales.
- Quien protege los datos es la API; el redireccionamiento es cortesía.

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: Cliente y tipos.
- [ ] **T2 (45 min)**: Métricas, tabla y acciones.
- [ ] **T3 (35 min)**: Instalaciones.
- [ ] **T4 (20 min)**: Protección y prueba manual.

**Archivos permitidos:** `lib/api/platform.ts`, `components/platform-console.tsx` (nuevos), `app/dashboard/super-admin/page.tsx`, `components/dashboard-views.tsx` (quitar `SuperAdminDashboard`), `components/app-shell.tsx`, `components/account-menu.tsx`, `lib/api/types.ts`, `app/globals.css`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–6 | Manual con Super Admin y otra cuenta; `npm run lint:web` | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `docs/FIGMA_MAP.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
