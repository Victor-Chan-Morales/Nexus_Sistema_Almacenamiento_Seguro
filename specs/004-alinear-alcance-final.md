# SPEC-004: ALINEAR LOS DOCUMENTOS CON EL ALCANCE FINAL

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N1 (solo documentación) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | Documentos de la raíz, `docs/` y `specs/` |
| **Requisitos Vinculados** | Todos (gobernanza) |
| **Dependencias** | Ninguna. **Va primero.** |
| **Prioridad** | P1 |
| **Estimación** | 1 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Que ningún documento contradiga las decisiones de `ADR-008`, para que los agentes no implementen reglas viejas.

## 3. Fuera de Alcance

- Cambios de código.
- Reescribir documentos históricos (`SESSION_LOG.md`, `docs/equipo/*`, `Planes de trabajo individuales/`).

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Decisiones aprobadas
  Dado ADR-008 aprobado por el coordinador
  Entonces su estado figura como "Aprobada" con fecha

Escenario 2: Sin contradicciones
  Cuando se busca en BUSINESS_RULES.md, CONTRACTS.md y ARCHITECTURE.md
  Entonces no quedan las reglas "no solicitar tarjetas", "deja de contar para la cuota a los 30 días" ni "no hay purga automática"
  Y CONTRACTS.md declara la versión v0.6

Escenario 3: Código sin tocar
  Entonces el PR solo modifica archivos .md
```

## 5. Contrato de API

Sin rutas nuevas. Abre la sección `v0.6` en `CONTRACTS.md`, donde cada spec agregará las suyas.

## 6. Datos y Esquema

No modifica la base de datos.

## 8. Diseño Técnico

| Documento | Cambio |
|---|---|
| `BUSINESS_RULES.md` | Planes, regla 4 (tarjetas de prueba, ADR-008 §5). Agregar equipos (§7), papelera (§9) y cierre de empresa (§6). |
| `CONTRACTS.md` | Encabezado v0.6. Reglas comunes: tarjetas de prueba. Papelera y cuota (§9). Mantener MFA fuera de alcance. |
| `ARCHITECTURE.md` | Interfaz de almacenamiento (ADR-008 §4), proxy inverso y ausencia de Redis. |
| `docs/decisions/ADR-006-*.md` | Remitir a SPEC-005 en "sin rotación" y dejar el streaming como fuera de alcance. |
| `docs/decisions/ADR-007-*.md` | Nota al inicio: §7 enmendado por ADR-008 §9. |
| `specs/README.md` | Verificar que coincide con este catálogo. |

## 9. Plan de Tareas

- [x] **T1 (15 min)**: Aprobar ADR-008 (2026-11-04).
- [ ] **T2 (35 min)**: Aplicar las enmiendas de la tabla.
- [ ] **T3 (10 min)**: Buscar las frases del escenario 2 y confirmar que no quedan.

**Archivos permitidos:** los de la tabla.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 1–3 | Revisión manual | Búsqueda de texto y diff del PR |

## 11. Impacto en Documentación

Es el objeto de esta spec.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
