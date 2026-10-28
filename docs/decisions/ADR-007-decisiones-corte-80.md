# ADR-007: Decisiones del corte del 80%

- **Estado:** Aprobada por el coordinador (Víctor Chán Morales) el 2026-10-27, tras la revisión de las specs 101–601.
- **Alcance:** fija las decisiones que las specs del corte del 80% asumen. Complementa ADR-002 y ADR-003; donde choca con ADR-003, la enmienda está anotada allí.
- **Contratos:** las rutas, campos y códigos de error de estas decisiones están en `CONTRACTS.md` v0.5.

## 1. Alcance y calendario

- El **viernes 30 de octubre de 2026** es el **corte del 80%**. El alcance "100%" (enlaces compartidos, carpetas de equipo, Super Admin real, ZIP, cadena de hashes verificable, manuales finales) queda para la primera semana de noviembre.
- Las fechas escritas en las specs (30-Oct, 100% Nov) son referencias de planificación, no compromisos distintos.

## 2. Numeración de requisitos

La numeración **RF-001…RF-016 y RNF-001…RNF-011 de la propuesta** es la única canónica. Lo que el curso exige y la propuesta no numera (recuperación de contraseña, historial de pagos, renovación) se cita como **"Curso §4.1"** / **"Curso §4.2"**.

| Tema | Requisito canónico |
|---|---|
| RBAC | RF-003 |
| Espacios personales | RF-007 |
| Versionado | RF-008 |
| Papelera y recuperación | RF-009 |
| Planes y límites | RF-013 |
| Panel de auditoría | RF-012 (+ RNF-007) |
| Panel Super Admin | RF-016 |
| Recuperación de contraseña | Curso §4.1 |
| Historial de pagos / renovación | Curso §4.2 |

## 3. Roles

- Roles de organización en BD, JWT y API: **`tenant_admin`** y **`colaborador`** (no existe `collaborator`).
- **Super Admin** no es un rol: es el flag `iam.user.is_super_admin`. No aparece en `req.user.role`.
- **Auditor** no se implementa en este corte. Los documentos académicos lo mencionan como actor "no implementado en este corte".

## 4. Matriz RBAC del corte

| Endpoint | Rol requerido |
|---|---|
| `POST /organizations/members`, `GET /organizations/members` | `tenant_admin` |
| `GET /audit/events` | `tenant_admin` |
| `POST /subscriptions/activate`, `POST /subscriptions/renew`, `GET /billing/operations` | `tenant_admin` |
| Resto de rutas autenticadas (archivos, papelera, versiones, dashboard, `/auth/me`) | cualquier miembro |
| `GET /plans`, `/auth/*` públicas | sin sesión |

El frontend oculta las acciones administrativas según el rol de la sesión, pero solo como cortesía visual: la API es quien autoriza.

## 5. Alta de miembros

- El administrador registra `{ fullName, email, role }`. La API crea la cuenta con una contraseña aleatoria inutilizable y envía un correo para que la persona defina la suya (mismo mecanismo que la recuperación de contraseña, token de **24 h** para invitaciones).
- Si el correo **ya existe en otra organización** → `422 EMAIL_BELONGS_TO_OTHER_ORGANIZATION`. No hay selector de organización: el login toma la membresía activa más antigua, así que vincular una cuenta existente la dejaría sin acceso a la nueva organización.
- Si ya es miembro de esta organización → `422 MEMBER_ALREADY_EXISTS`.
- Si la organización ya alcanzó el límite de usuarios de su plan → `422 USER_LIMIT_EXCEEDED`. Sin suscripción vigente el límite es 0.
- Definir la contraseña por el enlace del correo prueba la posesión del buzón: marca `email_verified = true`.

## 6. Recuperación de contraseña

- Token de **15 minutos**, de un solo uso, guardado como hash (`purpose = password_reset`). Respuesta genérica para correos inexistentes.
- Cambiar la contraseña **revoca todas las sesiones** del usuario (ADR-003). Esto absorbe a SPEC-107.
- El outbox de correo se generaliza: `kind` admite `email_verification`, `password_reset` y `member_invitation`. Los mensajes de reset e invitación no emiten token nuevo en el reintento: si su token vence, el mensaje se abandona y la persona solicita otro.

## 7. Papelera

- Solo **archivos** (no existe borrado de carpetas en este corte).
- Listar, restaurar y purgar se acotan al **Drive personal del solicitante**, igual que descargar y eliminar hoy. Un administrador no ve la papelera de otros miembros.
- **Enmienda a ADR-003:** la eliminación definitiva la puede ejecutar **el dueño del archivo** (no solo un administrador), porque en este corte no hay Drives de equipo ni vista administrativa de la papelera ajena. Sigue auditada.
- Restaurar con un nombre que ya tiene un archivo activo en la carpeta → `409 FILE_NAME_CONFLICT`.
- La retención de 30 días se **informa** (`retentionEndsAt`) pero **no hay proceso automático** que purgue. **Atención a la cuota:** hoy el cálculo de uso (`readStorageUsage`) cuenta un archivo eliminado solo mientras `deleted_at` esté dentro de los últimos 30 días; **pasado ese plazo deja de contar para la cuota aunque sus bytes sigan en SeaweedFS hasta que alguien lo purgue**. Es el comportamiento de CONTRACTS v0.4 ("durante sus 30 días") y no se cambia en este corte, pero significa que sin purga manual el almacenamiento real puede superar la cuota facturada. Limitación declarada; la purga automática es trabajo del 100%.

## 8. Auditoría

- **Eventos del corte** (`action_type`): `AUTH_LOGIN`, `AUTH_PASSWORD_RESET`, `MEMBER_ADDED`, `FILE_UPLOAD`, `FILE_DOWNLOAD`, `FILE_DELETE`, `FILE_RESTORE`, `FILE_PURGE`, `PLAN_ACTIVATED`, `PLAN_RENEWED`. Solo resultado `success`; los intentos fallidos no se registran (el esquema exige organización y un login fallido no la tiene).
- **Hash desde la v1:** cada evento guarda `record_hash` y `prev_hash` (ADR-003 y NOT NULL en BD). La verificación de la cadena y los checkpoints firmados quedan para SPEC-404.
- **Cada dueño engancha sus propios eventos** (IAM, Files, Billing) llamando a `AuditService`; Anthony entrega el servicio y no edita IAM ni Files.
- El registro es de mejor esfuerzo y ocurre **después del commit** de la operación: un fallo de auditoría nunca revierte ni bloquea la operación.
- Lectura de la bitácora: solo `tenant_admin`.

## 9. Facturación

- `POST /subscriptions/activate` ya cambia de plan y rechaza reducciones con `422 STORAGE_QUOTA_EXCEEDED`. **SPEC-302 deja de ser "cambio de plan"** y pasa a ser **renovación**: `POST /subscriptions/renew`.
- Cada activación que **crea** una suscripción escribe una operación `charge` (monto del plan, simulada). Reactivar el mismo plan (idempotente) no escribe nada. El alta de Demo escribe un `charge` de US$0.
- Renovar escribe una operación `renewal` y extiende la vigencia de la suscripción actual. Demo no es renovable.

## 10. Proceso

- **Contrato primero:** `CONTRACTS.md` v0.5 se aprueba antes de que empiece el código de las specs que lo usan.
- Las specs quedan en **"En revisión"** hasta que el coordinador las marque "Aprobada".
