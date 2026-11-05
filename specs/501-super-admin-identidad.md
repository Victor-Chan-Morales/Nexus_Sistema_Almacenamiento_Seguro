# SPEC-501: SUPER ADMIN, IDENTIDAD Y CONSULTAS

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (acceso entre organizaciones) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/iam/`, `apps/api/src/modules/integration/`, `apps/api/src/scripts/` |
| **Requisitos Vinculados** | RF-016 |
| **Dependencias** | SPEC-004 |
| **Prioridad** | P1 |
| **Estimación** | 2.5 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Reconocer al dueño de la plataforma con un control exclusivo y darle cifras reales. Hoy `is_super_admin` existe en la BD, pero no llega a la sesión.

## 3. Fuera de Alcance

- Acciones de escritura (SPEC-503) y pantalla (SPEC-502).
- **Ver archivos, nombres de archivo o miembros de otras organizaciones.**
- Selector de organización.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Sesión
  Dado un usuario con is_super_admin = true
  Cuando inicia sesión o consulta /auth/me
  Entonces la respuesta incluye isSuperAdmin: true
  Y es false para los demás

Escenario 2: Token no confiable
  Dado un JWT con un campo isSuperAdmin alterado
  Entonces no tiene efecto: el valor se lee de la base en cada solicitud

Escenario 3: Consultar organizaciones
  Dado un Super Admin
  Cuando envía GET /platform/organizations
  Entonces recibe nombre, estado, modelo, plan, uso, límite, miembros y fecha de alta de cada una
  Y nunca nombres de archivos ni correos de miembros

Escenario 4: Métricas
  Cuando envía GET /platform/metrics
  Entonces recibe totales de organizaciones por estado, usuarios activos, bytes usados y suscripciones por plan

Escenario 5: Sin permiso
  Dado un tenant_admin u otro usuario → 403 PLATFORM_ADMIN_REQUIRED
  Dado sin sesión → 401

Escenario 6: Sin concesión por API
  Entonces ninguna ruta ni DTO permite asignar is_super_admin

Escenario 7: Crear la cuenta
  Cuando se ejecuta npm run seed:super-admin con SUPER_ADMIN_EMAIL y SUPER_ADMIN_PASSWORD
  Entonces existe la cuenta, con su organización interna "Nexus Plataforma"
  Y repetir el comando no duplica nada

Escenario 8: Rol de organización intacto
  Entonces un Super Admin sin rol tenant_admin en otra organización no puede operar en ella
```

## 5. Contrato de API

| Método y ruta | Respuesta |
|---|---|
| `GET /platform/organizations?limit&offset` | `{ items: [{ id, name, status, deploymentModel, planName, usedBytes, storageLimitBytes, memberCount, createdAt }], total }` |
| `GET /platform/metrics` | `{ organizations: { active, suspended, cancelled }, activeUsers, usedBytes, subscriptionsByPlan: [{ planName, count }] }` |

`LoginResponse` y `MeResponse` añaden `isSuperAdmin`. Error nuevo: `403 PLATFORM_ADMIN_REQUIRED`.

## 6. Datos y Esquema

Sin migración.

## 8. Diseño Técnico

- **`AuthUser.isSuperAdmin`:** `JwtStrategy.validate` lo toma de `membership.user.isSuperAdmin`, ya cargado. No va en el JWT. Se añade solo a la respuesta en `session.service.ts`.
- **`SuperAdminGuard`:** después del guard JWT. Sin usuario o con `false` → 403. Falla cerrada, como `RolesGuard`.
- **`PlatformAdminService`:** en `modules/integration/`, con consultas agregadas de solo lectura y un filtro explícito de columnas.
- **Rendimiento:** una sola consulta con agregados, sin N+1.
- **Auditoría:** las consultas no se registran. Las acciones sí, en SPEC-503.
- **Riesgo:** exponer datos de clientes. Los DTO son explícitos y una prueba verifica que no incluyen `email` ni nombres de archivo.

## 9. Plan de Tareas

- [ ] **T1 (30 min)**: `AuthUser`, `JwtStrategy`, respuestas de sesión y guard.
- [ ] **T2 (60 min)**: Servicio y rutas.
- [ ] **T3 (20 min)**: Script de semilla.
- [ ] **T4 (40 min)**: Pruebas.

**Archivos permitidos:** `iam/interfaces/auth-user.interface.ts`, `iam/strategies/jwt.strategy.ts`, `iam/services/session.service.ts`, `iam/iam.controller.ts`, `iam/iam.errors.ts`, `iam/guards/super-admin.guard.ts` y su spec, `integration/platform-admin.service.ts`, `integration/platform.controller.ts`, sus specs (nuevos), `integration/integration.module.ts`, `scripts/seed-super-admin.ts` (nuevo), `apps/api/package.json`, `package.json`, `.env.example`, `lib/api/types.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1, 2, 5, 8 | Unitaria | `super-admin.guard.spec.ts`, `iam.session.spec.ts` |
| Escenarios 3, 4 | Unitaria | `platform-admin.service.spec.ts` |
| Escenario 7 | Manual con Postgres | Evidencia en el PR |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6.
- [ ] `ADR-007` §3: cubierto por ADR-008 §11.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
