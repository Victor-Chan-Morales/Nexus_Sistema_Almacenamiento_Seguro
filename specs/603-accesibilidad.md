# SPEC-603: ACCESIBILIDAD

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/` |
| **Requisitos Vinculados** | RNF-008, RNF-009 |
| **Dependencias** | Ninguna; conviene ejecutarla tras las demás pantallas |
| **Prioridad** | P3 |
| **Estimación** | 2 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Contraste suficiente y navegación con teclado en los flujos principales (WCAG 2.1 AA).

## 3. Fuera de Alcance

- Certificación formal y modo oscuro (ADR-008).

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Contraste
  Entonces el texto normal cumple 4.5:1 y el grande 3:1

Escenario 2: Teclado
  Entonces login, explorador, papelera, suscripción y configuración se completan solo con teclado
  Con foco visible

Escenario 3: Diálogos
  Entonces atrapan el foco, cierran con Escape y lo devuelven al botón de origen

Escenario 4: Lectores de pantalla
  Entonces los botones de solo ícono tienen aria-label y los formularios tienen etiqueta
```

## 5. Contrato de API

Sin cambios.

## 6. Datos y Esquema

No modifica la base de datos.

## 7. Interfaz de Usuario

Ajustes en tokens y componentes existentes, sin rediseño.

## 8. Diseño Técnico

Auditar con Lighthouse. No se agregan librerías al proyecto.

## 9. Plan de Tareas

- [ ] **T1 (40 min)**: Auditoría y lista priorizada.
- [ ] **T2 (60 min)**: Correcciones.
- [ ] **T3 (20 min)**: Verificación.

**Archivos permitidos:** `app/globals.css`, `components/dialog.tsx`, `docs/IDENTIDAD_VISUAL.md` y componentes señalados por la auditoría.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–4 | Lighthouse y recorrido con teclado | Resultado en el PR |

## 11. Impacto en Documentación

- [ ] `docs/IDENTIDAD_VISUAL.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
