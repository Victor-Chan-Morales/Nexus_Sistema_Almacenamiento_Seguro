# SPEC-220: EQUIPOS Y SUS MIEMBROS

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (migración y permisos) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/`, `database/migrations/` |
| **Requisitos Vinculados** | RF-006, RF-003 |
| **Dependencias** | SPEC-221 |
| **Prioridad** | P1 |
| **Estimación** | 2.5 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

El administrador crea equipos y decide quién pertenece a cada uno, con nivel de **lectura** o **edición**. Crear un equipo crea su Drive.

## 3. Fuera de Alcance

- Operar archivos dentro del Drive de equipo (SPEC-222, SPEC-224).
- Permisos por archivo (`files.resource_access`).
- Pantallas (SPEC-223).

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Crear
  Dado un tenant_admin
  Cuando envía POST /teams con { name }
  Entonces responde 201 y, en una sola transacción, se crean el equipo, su Drive tipo team y su carpeta raíz

Escenario 2: Nombre repetido
  Dado un equipo con ese nombre, sin distinguir mayúsculas → 409 TEAM_NAME_CONFLICT

Escenario 3: Agregar miembro
  Cuando envía POST /teams/:id/members con { userId, level: "read" | "write" }
  Entonces responde 201

Escenario 4: Miembro inválido
  Dado un usuario sin membresía activa en esta organización → 422 USER_NOT_IN_ORGANIZATION
  Dado alguien ya presente → 409 TEAM_MEMBER_EXISTS

Escenario 5: Cambiar nivel y quitar
  Cuando envía PATCH /teams/:id/members/:userId con { level }, o DELETE
  Entonces el cambio aplica en la siguiente solicitud

Escenario 6: Listar
  Dado un tenant_admin → GET /teams muestra todos los equipos
  Dado un colaborador → solo aquellos a los que pertenece

Escenario 7: Permisos y aislamiento
  Dado un colaborador intentando administrar → 403 FORBIDDEN_ROLE
  Dado un equipo de otra organización → 404

Escenario 8: Miembro eliminado de la organización
  Dado alguien eliminado o suspendido (SPEC-108)
  Entonces no aparece en la lista del equipo

Escenario 9: Auditoría
  Entonces se registran TEAM_CREATED, TEAM_MEMBER_ADDED, TEAM_MEMBER_LEVEL_CHANGED y TEAM_MEMBER_REMOVED
```

## 5. Contrato de API

| Método y ruta | Rol | Entrada | Respuesta |
|---|---|---|---|
| `POST /teams` | `tenant_admin` | `{ name }` | `201 { id, name, driveId, createdAt }` |
| `GET /teams` | miembro | — | `{ items: [{ id, name, driveId, memberCount, myLevel }] }` |
| `GET /teams/:id/members` | `tenant_admin` | — | `{ items: [{ userId, fullName, email, level, joinedAt }] }` |
| `POST /teams/:id/members` | `tenant_admin` | `{ userId, level }` | `201` |
| `PATCH /teams/:id/members/:userId` | `tenant_admin` | `{ level }` | `200` |
| `DELETE /teams/:id/members/:userId` | `tenant_admin` | — | `204` |

Eliminar equipos queda fuera de alcance: exigiría decidir qué pasa con sus archivos.

## 6. Datos y Esquema

```sql
-- migrate:up
ALTER TABLE files.team_member
  ADD COLUMN permission_level files.permission_level NOT NULL DEFAULT 'read';
ALTER TABLE files.team_member
  ADD CONSTRAINT ck_team_member_level CHECK (permission_level IN ('read', 'write'));
CREATE UNIQUE INDEX uq_team_name_per_organization ON files.team (organization_id, lower(name));
CREATE UNIQUE INDEX uq_drive_one_per_team ON files.drive (team_id) WHERE team_id IS NOT NULL;
-- migrate:down: quitar índices, restricción y columna
```

`ck_drive_type_owner` ya exige `team_id` y `owner_user_id` nulo en Drives de equipo.

## 8. Diseño Técnico

- `TeamsService`, `TeamsController` y entidades `Team`, `TeamMember` en `modules/files/`.
- **Raíz y destino del Drive:** reutilizar `ensureTenantResources`; exponerla si es necesario sin cambiar su lógica. Raíz con `destination_id` del destino predeterminado.
- **Validar membresía:** Files no accede a tablas de IAM. Agregar a `MemberAdmission` (ya exportada por `IamModule`) `isActiveMember(organizationId, userId)`.
- **Lista:** filtrar con la membresía activa; `DriveAccessService` usa `req.user`, ya revalidado, así que una fila residual de `team_member` no da acceso a quien fue dado de baja.
- **Límite de plan:** los equipos no tienen límite propio.

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: Migración y entidades.
- [ ] **T2 (60 min)**: Crear y listar equipos, con su Drive y raíz.
- [ ] **T3 (35 min)**: Miembros y auditoría.
- [ ] **T4 (35 min)**: Pruebas.

**Archivos permitidos:** la migración, `files/teams.service.ts`, `files/teams.controller.ts`, `files/entities/team.entity.ts`, `files/entities/team-member.entity.ts`, `files/dto/team.dto.ts`, su spec (nuevos), `files/files.service.ts` (solo exponer `ensureTenantResources`), `files/files.module.ts`, `iam/member-admission.ts`, `audit/audit.types.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–9 | Unitaria | `teams.service.spec.ts` |
| Escenario 1 y migración | Manual con Postgres (subir y bajar) | Evidencia en el PR |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6, `ENTS_REGISTRY.md`.
- [ ] `database/README.md` si cambia el procedimiento.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
