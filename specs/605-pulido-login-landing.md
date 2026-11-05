# SPEC-605: PULIDO DE LOGIN Y LANDING

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N0 |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/components/auth-forms.tsx`, `public-site.tsx`, `apps/web/src/app/globals.css` |
| **Requisitos Vinculados** | RNF-009 |
| **Dependencias** | Ninguna |
| **Prioridad** | P2 |
| **Estimación** | 1 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Aplicar tus notas: botones de regresar, menú fijo en la landing y animaciones suaves.

## 3. Fuera de Alcance

- Rediseño, nuevas secciones y librerías de animación.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Regresar
  Entonces login y registro muestran un botón de regresar claro

Escenario 2: Destino del botón de login
  Dada una sesión activa → lleva a /dashboard
  Sin sesión → lleva a la landing

Escenario 3: Menú fijo
  Cuando se desplaza por la landing
  Entonces el menú superior permanece visible y no tapa los títulos de las secciones ancladas

Escenario 4: Animaciones
  Entonces landing, login y registro tienen entradas sutiles de menos de 400 ms

Escenario 5: Movimiento reducido
  Dado prefers-reduced-motion → se desactivan
```

## 5. Contrato de API

Sin cambios.

## 6. Datos y Esquema

No modifica la base de datos.

## 7. Interfaz de Usuario

`position: sticky` en `.public-header`, y `scroll-margin-top` en las secciones. `@keyframes` en CSS; hoy no hay ninguno.

## 8. Diseño Técnico

Solo `transform` y `opacity`, para no provocar saltos de diseño. Tu nota decía "regresar al dashboard" en login; se interpreta como el escenario 2.

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: Botones.
- [ ] **T2 (15 min)**: Menú fijo.
- [ ] **T3 (25 min)**: Animaciones.

**Archivos permitidos:** `components/auth-forms.tsx`, `components/public-site.tsx`, `app/globals.css`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–5 | Manual; `npm run lint:web` | Captura en el PR |

## 11. Impacto en Documentación

Ninguno.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
