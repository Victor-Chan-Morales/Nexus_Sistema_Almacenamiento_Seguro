# SPEC-606: RETIRAR RESTOS DE DEMOSTRACIÓN

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/` |
| **Requisitos Vinculados** | REGLAS regla 11 (correspondencia) |
| **Dependencias** | SPEC-502, SPEC-601, SPEC-307 |
| **Prioridad** | P2 |
| **Estimación** | 1.5 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Eliminar componentes, rutas y datos ficticios, para que todo lo visible sea real.

## 3. Fuera de Alcance

- El plan comercial llamado "Demo", que es real.
- `seed:demo`, que es una herramienta de desarrollo.
- Avisos de "simulado" en facturación, que deben permanecer.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Sin datos ficticios
  Cuando se busca en apps/web/src
  Entonces no quedan imports de lib/demo.ts, lib/billing-demo.ts ni file-browser.tsx
  Y esos archivos desaparecen, si no tienen otros usos

Escenario 2: Rutas
  Entonces /dashboard/vacio y /dashboard/cuota-excedida se eliminan o usan datos reales
  Y ningún enlace queda roto

Escenario 3: Sin prop demo
  Entonces AppShell ya no admite demo y DemoBanner desaparece

Escenario 4: Estados reales
  Entonces un dashboard sin archivos y uno con la cuota llena se ven correctamente con datos reales

Escenario 5: Compila
  Entonces npm run build:web y npm run lint:web pasan
```

## 5. Contrato de API

Sin cambios.

## 6. Datos y Esquema

No modifica la base de datos.

## 8. Diseño Técnico

Revisar `client-store.ts`, `dashboard-views.tsx` y `file-browser.tsx` con cuidado: **eliminar solo lo que confirme no tener usos** mediante búsqueda.

## 9. Plan de Tareas

- [ ] **T1 (30 min)**: Inventario de usos.
- [ ] **T2 (45 min)**: Eliminar y ajustar rutas.
- [ ] **T3 (15 min)**: Compilar y recorrer pantallas.

**Archivos permitidos:** los del inventario en `apps/web/src/`, más `docs/FIGMA_MAP.md`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–5 | Búsqueda, compilación y manual | Salida en el PR |

## 11. Impacto en Documentación

- [ ] `docs/FIGMA_MAP.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
