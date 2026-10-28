# SPEC-104: LISTADO DE MIEMBROS DE LA ORGANIZACIÓN

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (toca `modules/iam/`, zona protegida: REGLAS.md regla 4) |
| **Responsable Principal** | Sebastián (Dominio IAM) |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/iam/` |
| **Requisitos Vinculados** | RF-003 |
| **Dependencias** | SPEC-101 (`@Roles`) y SPEC-102 T2 (`MemberAdmission`, para `userLimit`). |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) |
| **Estimación** | 1.0 h |
| **Estado** | En revisión (reescrita 2026-10-27 según ADR-007) |

---

## 2. Objetivo

`GET /api/organizations/members` devuelve los miembros de la organización del solicitante, con su rol, estado y el límite de usuarios del plan, para la pantalla de configuración (SPEC-106).

---

## 3. Fuera de Alcance (YAGNI)

- Paginación, búsqueda y filtros (límite máximo de miembros: 100).
- Miembros suspendidos en el conteo de cupo: se listan, pero `userLimit` se compara solo con los activos (SPEC-102).

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Listado para el administrador
  Dado un "tenant_admin" de "ORG-1"
  Cuando envía GET /api/organizations/members
  Entonces responde 200 con members[] de ORG-1 (id, userId, fullName, email, role, status, joinedAt), totalMembers y userLimit

Escenario 2: Aislamiento
  Dado que existen miembros de "ORG-2"
  Entonces ninguno aparece en la respuesta de ORG-1

Escenario 3: Colaborador
  Dado un usuario "colaborador"
  Entonces responde 403 FORBIDDEN_ROLE

Escenario 4: Datos sensibles
  Entonces la respuesta nunca incluye password_hash, tokens ni campos de sesión
```

---

## 5. Contrato de API

Ver `CONTRACTS.md` v0.5, "Miembros de la organización".

`GET /api/organizations/members` — `@Roles(Role.TENANT_ADMIN)`. `userLimit` es `null` si no hay plan vigente.

---

## 6. Datos y Esquema

- **¿Modifica BD?** No. Consulta `iam.membership` ⋈ `iam."user"` ⋈ `iam.role` con `WHERE organization_id = :orgId`, orden `created_at ASC`.

---

## 7. Interfaz de Usuario

Pantalla en SPEC-106.

---

## 8. Diseño Técnico

- `MembershipRepository.listByOrganization(organizationId)` (nuevo método del puerto + implementación TypeORM). Mapear a `MemberDto` (nunca devolver la entidad `User`).
- `MembersService.list(actor)` suma `userLimit` vía `MemberAdmission.userLimit(orgId)`.
- Sin auditoría (lectura).

---

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: `listByOrganization` y `MemberDto`/respuesta.
- [ ] **T2 (15 min)**: `MembersService.list` y `@Get()` en `MembersController` con `@Roles(Role.TENANT_ADMIN)`.
- [ ] **T3 (25 min)**: pruebas (escenarios 1–4).

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1, 2, 4 | Unitaria | `modules/iam/members.service.spec.ts` |
| Escenario 3 | Unitaria | `modules/iam/members.controller.spec.ts` |

---

## 11. Impacto en Documentación

- [x] `CONTRACTS.md` v0.5.

---

## 12. Preguntas Abiertas

Ninguna.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-27 | Revisión | Nivel N2 (zona IAM); `fullName` y `joinedAt` según el contrato; solo `tenant_admin`; añadido `userLimit`; sin exponer entidades. |
