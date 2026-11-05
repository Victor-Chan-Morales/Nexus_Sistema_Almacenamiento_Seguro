# SPEC-307: COMPARATIVA DE PLANES

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/web/src/app/planes/`, `apps/web/src/lib/plans.ts` |
| **Requisitos Vinculados** | RF-013, Curso §4.2 |
| **Dependencias** | Ninguna |
| **Prioridad** | P2 |
| **Estimación** | 2 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Mostrar con claridad la diferencia entre planes, con los datos de `GET /plans` en lugar de valores fijos del frontend.

## 3. Fuera de Alcance

- Cambiar precios o límites.
- Funciones diferenciadas por plan que el sistema no aplique: **no se promete nada que no exista**.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Comparativa
  Cuando abre /planes
  Entonces compara precio, vigencia, almacenamiento y usuarios de los cuatro planes

Escenario 2: Origen
  Cuando cambia un valor en la API
  Entonces la pantalla lo refleja sin tocar el frontend

Escenario 3: Plan actual
  Dada una sesión
  Entonces marca el plan actual y ofrece Contratar o Cambiar según corresponda

Escenario 4: Sin sesión
  Entonces la acción lleva a registro

Escenario 5: API no disponible
  Entonces muestra un error con reintento, no datos fijos

Escenario 6: Móvil
  Entonces se lee a 360 px, sin desplazamiento horizontal de la página
```

## 5. Contrato de API

Consume `GET /plans` y `GET /dashboard`.

## 6. Datos y Esquema

No modifica la base de datos.

## 7. Interfaz de Usuario

Estados de carga, error y datos. Unidades con `formatBytes`.

## 8. Diseño Técnico

Revisar usos de `lib/plans.ts` y `lib/billing-demo.ts`. Lo que siga siendo necesario para la landing se conserva hasta SPEC-606.

## 9. Plan de Tareas

- [ ] **T1 (75 min)**: Comparativa desde la API.
- [ ] **T2 (45 min)**: Plan actual, móvil y prueba.

**Archivos permitidos:** `app/planes/page.tsx`, `lib/plans.ts`, `app/globals.css`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–6 | Manual; `npm run lint:web` | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `docs/FIGMA_MAP.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
