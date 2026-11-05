# SPEC-406: FILTROS Y EXPORTACIÓN DE AUDITORÍA

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (toca el flujo de login y auditoría) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/audit/`, `apps/api/src/modules/iam/`, `apps/web/src/components/audit-log.tsx` |
| **Requisitos Vinculados** | RF-012 |
| **Dependencias** | SPEC-407 |
| **Prioridad** | P2 |
| **Estimación** | 2 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Hacer útil el panel: filtros reales por acción, fecha y persona; exportación a CSV; y registro de inicios de sesión fallidos. Hoy el filtro solo actúa sobre lo ya cargado.

## 3. Fuera de Alcance

- Búsqueda de texto libre o informes programados.
- Registrar fallos de correos que no existen (no tienen organización).

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Filtros
  Cuando envía GET /audit/events?action&actorId&from&to
  Entonces responde solo con los eventos coincidentes, con paginación

Escenario 2: Nombres
  Entonces la tabla muestra la persona y la acción en español, no códigos

Escenario 3: CSV
  Cuando un tenant_admin envía GET /audit/events/export con filtros
  Entonces descarga un CSV de máximo 10 000 filas

Escenario 4: Inyección en CSV
  Dado un valor que empieza con =, +, - o @
  Entonces se escapa

Escenario 5: Login fallido
  Dado un usuario existente con contraseña incorrecta y membresía activa
  Entonces se registra AUTH_LOGIN con resultado failure
  Y la respuesta sigue siendo idéntica y sin demora perceptible

Escenario 6: Permisos y aislamiento
  Dado un colaborador → 403
  Y solo se ven eventos de la organización propia
```

## 5. Contrato de API

`GET /audit/events` añade `action`, `actorId`, `from`, `to`. `GET /audit/events/export` → `text/csv`.

## 6. Datos y Esquema

Sin migración. Si hace falta, índice por `(organization_id, action_type, occurred_at)`.

## 8. Diseño Técnico

- `void this.audit.logEvent(...)`: no se espera, como el resto, y no altera el error de login.
- Generar el CSV por lotes; codificación UTF-8 con BOM para Excel.
- Unir con `SPEC-112` en el flujo de contraseña incorrecta, sin duplicar lógica.

## 9. Plan de Tareas

- [ ] **T1 (40 min)**: Filtros en el servidor.
- [ ] **T2 (30 min)**: CSV.
- [ ] **T3 (15 min)**: Login fallido.
- [ ] **T4 (35 min)**: Pantalla y pruebas.

**Archivos permitidos:** `audit/audit.service.ts`, `audit/audit.controller.ts`, `audit/dto/list-audit-events.dto.ts`, sus specs, `iam/services/auth.service.ts`, `components/audit-log.tsx`, `lib/api/audit.ts`, `lib/api/types.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1, 3–6 | Unitaria | `audit.service.spec.ts`, `iam.security.spec.ts` |
| Escenario 2 | Manual | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6, `ADR-007` §8 (cubierto por ADR-008 §10).

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
