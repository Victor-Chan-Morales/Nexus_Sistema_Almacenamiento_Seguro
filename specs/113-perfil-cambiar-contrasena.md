# SPEC-113: EDITAR PERFIL Y CAMBIAR CONTRASEÑA

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (IAM) |
| **Responsable Principal** | Víctor Chán Morales |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/iam/`, `apps/web/src/components/profile-page.tsx` |
| **Requisitos Vinculados** | RF-001, Curso §4.1 |
| **Dependencias** | SPEC-601 |
| **Prioridad** | P2 |
| **Estimación** | 2 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Cambiar el nombre y la contraseña desde la sesión, escribiendo la actual, sin pasar por "olvidé mi contraseña".

## 3. Fuera de Alcance

- Cambiar el correo y ver o cerrar sesiones individuales.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Nombre
  Cuando envía PATCH /auth/me con { fullName }
  Entonces responde 200 y el perfil lo refleja

Escenario 2: Contraseña
  Cuando envía POST /auth/change-password con la actual correcta y una nueva válida
  Entonces cambia, se revocan todas sus sesiones y debe iniciar sesión de nuevo (ADR-003)
  Y se registra AUTH_PASSWORD_CHANGED

Escenario 3: Contraseña actual incorrecta → 401 INVALID_CREDENTIALS, sin cambios

Escenario 4: Nueva inválida → 400 VALIDATION_ERROR, con la política de password-policy.ts

Escenario 5: Pantalla
  Entonces /perfil muestra ambos formularios, con estados de proceso y error
```

## 5. Contrato de API

`PATCH /auth/me` `{ fullName }` → `MeResponse`. `POST /auth/change-password` `{ currentPassword, newPassword }` → `204`, limpia la cookie.

## 6. Datos y Esquema

Sin migración.

## 8. Diseño Técnico

- `AccountService` en IAM. Reutilizar `PasswordHasher`, `password-policy.ts` y `SessionRepository.revokeAllActiveOf`, en una transacción.
- Sumar el intento fallido de SPEC-112 si ya está fusionada.
- **Error en pantalla:** aquí `401 INVALID_CREDENTIALS` significa contraseña incorrecta, no sesión vencida. La pantalla revisa `code` antes de llamar a `failSession`, que cierra la sesión ante cualquier `401`.

## 9. Plan de Tareas

- [ ] **T1 (60 min)**: Servicio, rutas y auditoría.
- [ ] **T2 (30 min)**: Pantalla.
- [ ] **T3 (30 min)**: Pruebas.

**Archivos permitidos:** `iam/services/account.service.ts` y su spec, `iam/dto/change-password.dto.ts`, `iam/dto/update-profile.dto.ts` (nuevos), `iam/iam.controller.ts`, `iam/iam.module.ts`, `iam/ports/repositories.ts`, `iam/infrastructure/typeorm-repositories.ts`, `audit/audit.types.ts`, `components/profile-page.tsx`, `lib/api/iam.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–4 | Unitaria | `account.service.spec.ts` |
| Escenario 5 | Manual | Capturas en el PR |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
| 2026-11-04 | Claude Code (revisión) | Se aclara cómo distingue la pantalla una contraseña incorrecta de una sesión vencida. Aprobado por el coordinador (2026-11-04). |
| 2026-11-10 | Claude Code (implementación) | Responsable asignado a Víctor Chán Morales (decisión D8). Implementación de SPEC-113. |
