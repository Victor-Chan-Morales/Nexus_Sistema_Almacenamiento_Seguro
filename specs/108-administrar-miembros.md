# SPEC-108: ADMINISTRAR MIEMBROS (BACKEND)

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (IAM y permisos) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/iam/`, `apps/api/src/modules/audit/` |
| **Requisitos Vinculados** | RF-003, Auditoría §8 (cambios de permisos) |
| **Dependencias** | SPEC-004 |
| **Prioridad** | P1 |
| **Estimación** | 2.5 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

El administrador puede cambiar el rol, suspender, reactivar o eliminar colaboradores. Hoy solo puede agregarlos y listarlos.

## 3. Fuera de Alcance

- Transferir los archivos de quien se elimina.
- Pantalla (SPEC-109).
- Volver a invitar un correo eliminado (ver §12).

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Cambiar rol
  Dado un tenant_admin y otro miembro
  Cuando envía PATCH /organizations/members/:id con { role }
  Entonces responde 200 y el nuevo rol aplica en la siguiente solicitud

Escenario 2: Suspender
  Cuando envía PATCH con { status: "suspended" }
  Entonces se revocan las sesiones del usuario
  Y su siguiente solicitud con access token vigente responde 401

Escenario 3: Reactivar
  Cuando envía PATCH con { status: "active" } y hay cupo en el plan
  Entonces la persona puede iniciar sesión de nuevo

Escenario 4: Reactivar sin cupo
  Dado que la organización alcanzó su límite
  Entonces responde 422 USER_LIMIT_EXCEEDED

Escenario 5: Eliminar
  Cuando envía DELETE /organizations/members/:id
  Entonces desaparece la membresía, el usuario queda inactive y se revocan sus sesiones
  Y sus archivos no se borran
  Y el cupo del plan se libera

Escenario 6: Último administrador
  Dado un único tenant_admin activo
  Cuando otro actor intenta o él mismo intenta quitarle el rol, suspenderlo o eliminarlo
  Entonces responde 422 LAST_ADMIN_REQUIRED

Escenario 7: Concurrencia
  Dados dos administradores que se eliminan entre sí a la vez
  Entonces queda al menos uno

Escenario 8: Sobre uno mismo
  Cuando un administrador intenta suspenderse o eliminarse a sí mismo
  Entonces responde 422 CANNOT_MODIFY_SELF

Escenario 9: Permisos y aislamiento
  Dado un colaborador → 403 FORBIDDEN_ROLE
  Dado un id de otra organización o inexistente → 404
```

## 5. Contrato de API

| Método y ruta | Rol | Entrada | Respuesta |
|---|---|---|---|
| `PATCH /organizations/members/:id` | `tenant_admin` | `{ role? , status? }` (al menos uno) | `200 { id, userId, email, fullName, role, status, joinedAt }` |
| `DELETE /organizations/members/:id` | `tenant_admin` | — | `204` |

Errores nuevos: `422 LAST_ADMIN_REQUIRED`, `422 CANNOT_MODIFY_SELF`. Reutiliza `USER_LIMIT_EXCEEDED`, `FORBIDDEN_ROLE`, `NOT_FOUND`.

## 6. Datos y Esquema

Sin migración. Usa `iam.membership.status`, `role_id` e `iam."user".status`.

## 8. Diseño Técnico

```typescript
// MembersService
update(actor: AuthUser, membershipId: string, dto: UpdateMemberDto): Promise<MemberDto>;
remove(actor: AuthUser, membershipId: string): Promise<void>;
```

- **Transacción:** `organizations.lockById` (mismo candado que `addMember`, serializa y resuelve los escenarios 4 y 7) → cargar la membresía con filtro por `organizationId` → validar reglas → escribir → `sessions.revokeAllActiveOf`.
- **Efecto inmediato:** ya existe; `JwtStrategy` revalida la membresía en cada solicitud.
- **Auditoría, tras el commit:** `MEMBER_ROLE_CHANGED`, `MEMBER_SUSPENDED`, `MEMBER_REACTIVATED`, `MEMBER_REMOVED`, con `AuditResource.MEMBERSHIP`.
- **Contar administradores:** activos con rol `tenant_admin` en la organización, dentro de la transacción.

## 9. Plan de Tareas

- [ ] **T1 (30 min)**: DTO, rutas y errores.
- [ ] **T2 (60 min)**: Repositorio y `update`/`remove`.
- [ ] **T3 (15 min)**: Acciones de auditoría.
- [ ] **T4 (45 min)**: Pruebas.

**Archivos permitidos:** `iam/members.controller.ts`, `iam/services/members.service.ts`, `iam/dto/update-member.dto.ts` (nuevo), `iam/iam.errors.ts`, `iam/ports/repositories.ts`, `iam/infrastructure/typeorm-repositories.ts`, `audit/audit.types.ts`, `iam/members*.spec.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–6, 8, 9 | Unitaria | `members.service.spec.ts`, `members.controller.spec.ts` |
| Escenario 7 | E2E con Postgres | `apps/api/test/iam.e2e-spec.ts` |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6: rutas, errores y acciones de auditoría.
- [ ] `docs/modules/IAM.md`.

## 12. Preguntas Abiertas

Ninguna. Decisiones del coordinador (2026-11-04):

1. **Archivos de quien se elimina:** se conservan, siguen ocupando cuota y nadie puede abrirlos.
2. **Volver a invitar:** el correo sigue existiendo, así que `POST /organizations/members` responde `EMAIL_BELONGS_TO_OTHER_ORGANIZATION`. Si la baja puede revertirse, se usa "Suspender".

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada, con decisiones de §12. |
