# SPEC-115: CORREOS INFORMATIVOS EN MAILPIT

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (cada tipo de correo nuevo requiere migración) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `package.json`, `apps/api/src/modules/iam/`, `apps/api/src/modules/integration/` |
| **Requisitos Vinculados** | Curso §4.1 |
| **Dependencias** | SPEC-108, SPEC-114 (solo T2 y T3; T1 puede hacerse antes) |
| **Prioridad** | P2 |
| **Estimación** | 2 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Que `npm run infra:up` levante Mailpit, y avisar por correo los cambios importantes de la cuenta. Hoy el script omite Mailpit y los correos no llegan.

## 3. Fuera de Alcance

- Plantillas elaboradas o proveedores reales.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Infraestructura
  Cuando ejecuta npm run infra:up
  Entonces postgres, seaweedfs y mailpit quedan en marcha

Escenario 2: Correos informativos
  Cuando un plan se activa, cambia o renueva → reciben correo los tenant_admin activos
  Cuando un miembro se suspende o elimina → recibe correo esa persona
  Cuando la empresa se cierra → reciben correo todos sus miembros activos
  Entonces cada correo pasa por la outbox y se ve en http://localhost:8025

Escenario 2b: Sin cambio real
  Dada una activación idempotente del plan vigente
  Entonces no se envía correo

Escenario 2c: El correo no bloquea
  Dado que el envío falla
  Entonces la operación de origen sigue siendo exitosa

Escenario 3: Sin datos sensibles
  Entonces los correos no incluyen contraseñas, tokens ni nombres de archivo
```

## 5. Contrato de API

Sin cambios.

## 6. Datos y Esquema

`ck_email_outbox_kind` limita los tipos de correo, así que cada tipo nuevo requiere una migración, como `20261027090000_allow_password_reset_outbox_kinds.sql`.

## 8. Diseño Técnico

- `infra:up`: agregar `mailpit` a la lista de servicios.
- **Tipos nuevos:** `plan_changed`, `member_status_changed` y `organization_closed`, en `OUTBOX_KINDS` y en la migración.
- **Sin token:** hoy `enqueue` exige `rawToken` y `expiresAt`, y `encrypted_payload` no admite nulos. Los avisos nuevos cifran una cadena vacía y usan `expiresAt` a 24 h, igual que el horizonte de reintentos.
- **Entre módulos:** `AccountNotices` (nuevo, en IAM) resuelve los destinatarios y encola en su propia transacción, tras el commit de la operación de origen. Nunca lanza hacia quien llama. `IamModule` lo exporta e `IntegrationModule` lo importa.
- **Cierre de empresa:** los destinatarios se leen antes de cerrarla, porque después deja de estar activa.

## 9. Plan de Tareas

- [ ] **T1 (10 min)**: `infra:up` y actualizar la advertencia en `REGLAS.md`.
- [ ] **T2 (50 min)**: Migración, tipos, plantillas y `AccountNotices`.
- [ ] **T3 (60 min)**: Conectar los tres eventos y probarlos.

**Archivos permitidos:** `package.json`, `REGLAS.md`, la migración, `iam/constants.ts`, `iam/ports/verification-mailer.ts`, `iam/services/account-notices.service.ts` y su spec (nuevos), `iam/services/email-outbox.service.ts`, `iam/infrastructure/email.service.ts`, `iam/iam.module.ts`, `iam/services/members.service.ts`, `integration/integration.module.ts`, `integration/subscription.coordinator.ts`, `integration/subscriptions.controller.ts`, `integration/organization-closure.service.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Evidencia |
|---|---|---|
| Escenarios 2b, 2c y 3 | Unitaria | `account-notices.service.spec.ts`, `email-outbox.service.spec.ts` |
| Escenarios 1 y 2 | Manual en Mailpit | Captura en el PR |

## 11. Impacto en Documentación

- [ ] `REGLAS.md`, `Levantar proyecto nexus`.

## 12. Preguntas Abiertas

Ninguna. Decisión del coordinador (2026-11-04): plan activado, cambiado o renovado; miembro suspendido o eliminado; y empresa cerrada.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. Lista de correos confirmada; se agregan dependencias, archivos y 1 h para cubrirla. |
