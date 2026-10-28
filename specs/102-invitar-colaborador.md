# SPEC-102: ALTA DE MIEMBROS DE LA ORGANIZACIÓN

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (Zona Protegida - Permisos, membresías y límites) |
| **Responsable Principal** | Sebastián (Dominio IAM). Anthony registra la política de límite (T6). |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/iam/` y `apps/api/src/modules/billing/registration/` |
| **Requisitos Vinculados** | RF-003, Curso §4.1 (roles Administrador y Cliente) |
| **Dependencias** | SPEC-101 (`@Roles`) y SPEC-103 T2 (outbox generalizado, `member_invitation`). |
| **Hito Objetivo** | Corte 80% (30-Oct-2026) |
| **Estimación** | 2.5 h |
| **Estado** | Aprobada (2026-10-28, Víctor Chán) |

---

## 2. Objetivo

Hoy solo existen administradores: no hay forma de crear un `colaborador`. Esta spec añade `POST /api/organizations/members` para que un `tenant_admin` agregue un miembro a su organización. La persona recibe un correo para definir su contraseña.

---

## 3. Fuera de Alcance (YAGNI)

- Vincular una cuenta que **ya existe en otra organización**. No hay selector de organización: el login toma la membresía activa más antigua, así que esa persona no podría usar la nueva (ADR-007 §5).
- Reenvío manual de invitación, invitaciones pendientes con estado propio, cambio de rol, suspensión o baja de miembros.
- Roles distintos de `tenant_admin` y `colaborador`.

---

## 4. Criterios de Aceptación (Gherkin)

```gherkin
Escenario 1: Administrador agrega un colaborador
  Dado un usuario "tenant_admin" de la organización "ORG-1" con cupo disponible en su plan
  Cuando envía POST /api/organizations/members con { fullName: "Ana Pérez", email: "ana@empresa.com", role: "colaborador" }
  Entonces responde 201 con { id, userId, email, fullName, role: "colaborador", status: "active", createdAt }
  Y se crea el usuario (contraseña aleatoria inutilizable, email_verified=false) y su membresía activa en ORG-1
  Y se encola un correo "member_invitation" con un token de 24 h
  Y el correo se envía después del commit

Escenario 2: Un colaborador intenta agregar miembros
  Dado un usuario con rol "colaborador"
  Cuando envía POST /api/organizations/members
  Entonces responde 403 FORBIDDEN_ROLE y no se crea nada

Escenario 3: Ya es miembro
  Dado que el correo ya tiene membresía en ORG-1
  Entonces responde 422 MEMBER_ALREADY_EXISTS

Escenario 4: El correo existe en otra organización
  Dado que el correo pertenece a una cuenta con membresía en otra organización
  Entonces responde 422 EMAIL_BELONGS_TO_OTHER_ORGANIZATION y no se modifica esa cuenta

Escenario 5: Límite de usuarios
  Dado una organización con tantos miembros activos como el límite de su plan (Demo: 5)
  Entonces responde 422 USER_LIMIT_EXCEEDED
  Y lo mismo si no hay suscripción vigente

Escenario 6: Atomicidad
  Dado que falla la creación de la membresía o del mensaje del outbox
  Entonces no queda usuario, membresía ni token creados

Escenario 7: Aislamiento
  Dado que el organizationId viaja en el cuerpo
  Entonces la API lo rechaza (forbidNonWhitelisted) y usa siempre el del token
```

---

## 5. Contrato de API

Ver `CONTRACTS.md` v0.5, "Miembros de la organización".

`POST /api/organizations/members` — `@Roles(Role.TENANT_ADMIN)`.

```json
{ "fullName": "Ana Pérez", "email": "ana@empresa.com", "role": "colaborador" }
```

| HTTP | `code` | Causa |
|---|---|---|
| 201 | — | Miembro creado. |
| 400 | `VALIDATION_ERROR` | Nombre, correo o rol inválidos. |
| 403 | `FORBIDDEN_ROLE` | No es `tenant_admin`. |
| 422 | `MEMBER_ALREADY_EXISTS` | Ya es miembro de esta organización. |
| 422 | `EMAIL_BELONGS_TO_OTHER_ORGANIZATION` | El correo existe en otra organización. |
| 422 | `USER_LIMIT_EXCEEDED` | Cupo del plan agotado o sin plan vigente. |

---

## 6. Datos y Esquema

- **¿Modifica BD?** No (usa `iam.user`, `iam.membership`, `iam.one_time_token`, `iam.email_outbox`; el `kind` nuevo lo cubre la migración de SPEC-103).
- `iam.user.full_name` es NOT NULL: por eso el cuerpo exige `fullName`.
- `iam.user.password_hash` es NOT NULL: se guarda el hash Argon2id de un secreto aleatorio que nadie conoce.
- El Drive personal del nuevo miembro se crea de forma diferida en su primer uso (`getOrCreateUserDrive`).

---

## 7. Interfaz de Usuario (UI/UX)

Pantalla en SPEC-106.

---

## 8. Diseño Técnico

- **Controlador** `members.controller.ts` (`@Controller('organizations/members')`, `@UseGuards(AuthGuard('jwt'), RolesGuard)`): `@Post()` con `@Roles(Role.TENANT_ADMIN)`; `organizationId` solo de `req.user`.
- **Servicio** `members.service.ts`: `addMember(actor: AuthUser, dto: AddMemberDto): Promise<MemberDto>`. DTO con `@IsString @Length(2,150) fullName`, `@IsEmail email`, `@IsEnum(Role) role`.
- **Política de límite sin acoplar IAM a Billing** (mismo idioma que `RegistrationHooks`): IAM define `member-admission.ts` con `MemberAdmission` (`register(source)`, `userLimit(organizationId): Promise<number | null>`). Billing registra la fuente en `onModuleInit` (`modules/billing/registration/user-limit.hook.ts`) usando `BillingService.getSubscription(orgId)` → `plan.maxMembers`. Si no hay fuente registrada o no hay plan, el límite es 0 (falla cerrada → `USER_LIMIT_EXCEEDED`).
- **Orden de comprobaciones** (todo dentro de una `UnitOfWork`): (1) correo normalizado; (2) ¿existe usuario? membresía en esta org → `MEMBER_ALREADY_EXISTS`; en otra → `EMAIL_BELONGS_TO_OTHER_ORGANIZATION`; (3) contar membresías activas de la org vs `userLimit`; (4) crear usuario + membresía; (5) crear token (purpose `password_reset`, 24 h) + mensaje `member_invitation`. Tras el commit: `dispatch(id)` sin esperarlo.
- **Puertos nuevos:** `MembershipRepository` necesita métodos para buscar la membresía de un usuario en cualquier organización y contar las activas de una organización (hoy solo tiene `create` y `findActive`); añadirlos al puerto y a la implementación TypeORM.
- **Concurrencia:** dos altas simultáneas podrían exceder el límite; bloquear la fila de la organización (`SELECT ... FOR UPDATE` sobre `admin.organization`) antes de contar.
- **Auditoría:** `MEMBER_ADDED` se añade en SPEC-405.
- **Riesgos:** (a) pre-registro de un correo ajeno: la cuenta queda sin contraseña utilizable y solo el dueño del buzón puede definirla; (b) revela a un administrador que un correo existe en otra organización: se acepta por ser un endpoint solo de administradores; (c) invitación perdida: el administrador no puede reenviarla en este corte (limitación declarada).

---

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: `AddMemberDto` y `MemberDto`.
- [ ] **T2 (20 min)**: `MemberAdmission` (puerto) y su registro en `IamModule`.
- [ ] **T3 (50 min)**: `MembersService.addMember` (comprobaciones, transacción, bloqueo, outbox).
- [ ] **T4 (15 min)**: `MembersController` y registro en `IamModule`.
- [ ] **T5 (45 min)**: pruebas (escenarios 1–7).
- [ ] **T6 (Anthony, 20 min)**: `UserLimitHook` en Billing que registra la fuente del límite.

---

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1, 3, 4, 5, 6 | Unitaria | `modules/iam/members.service.spec.ts` |
| Escenarios 2 y 7 | Unitaria | `modules/iam/members.controller.spec.ts` |
| Fuente del límite | Unitaria | `modules/billing/billing.user-limit.spec.ts` |

---

## 11. Impacto en Documentación

- [x] `CONTRACTS.md` v0.5.
- [ ] `docs/modules/IAM.md`: alta de miembros y límite.

---

## 12. Preguntas Abiertas

Ninguna. Decisiones: ADR-007 §5.

---

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-10-27 | Víctor Chán | Versión inicial. |
| 2026-10-28 | Revisión | Anotados los métodos nuevos que requiere `MembershipRepository`. |
| 2026-10-27 | Revisión | Rol `colaborador`; `fullName` obligatorio; mecanismo de alta decidido (correo para definir contraseña); `EMAIL_BELONGS_TO_OTHER_ORGANIZATION`; límite de usuarios del plan; dependencia de 103; atomicidad y bloqueo concurrente; códigos de error alineados con el filtro (`VALIDATION_ERROR`). |
