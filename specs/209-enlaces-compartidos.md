# SPEC-209: CREAR, LISTAR Y REVOCAR ENLACES COMPARTIDOS

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (seguridad) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/`, `apps/api/src/modules/iam/iam.module.ts` |
| **Requisitos Vinculados** | RF-010, RF-011 |
| **Dependencias** | SPEC-206 |
| **Prioridad** | P1 |
| **Estimación** | 2 h |
| **Estado** | Implementada (2026-11-06). Aprobada el 2026-11-04 por Víctor Chán Morales |

## 2. Objetivo

Crear y administrar enlaces temporales a una versión fija de un archivo, con contraseña opcional y revocación inmediata. El acceso público es SPEC-216.

## 3. Fuera de Alcance

- Abrir el enlace sin sesión (SPEC-216) y pantallas (SPEC-217).
- Enlaces a carpetas, envío por correo y límite de descargas.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Crear
  Dado un archivo activo al que tiene acceso de edición
  Cuando envía POST /files/:id/share-links con { expiresInDays: 7 }
  Entonces responde 201 con id, token, expiresAt y hasPassword: false
  Y el enlace apunta a la versión vigente
  Y solo se guarda el hash del token

Escenario 2: Con contraseña
  Cuando incluye password
  Entonces se guarda solo su hash Argon2id y hasPassword es true

Escenario 3: Duración inválida
  Dado expiresInDays distinto de 1, 7 o 30 → 400 VALIDATION_ERROR

Escenario 4: El token solo se ve una vez
  Cuando lista los enlaces
  Entonces no aparece ni el token ni su hash

Escenario 5: Listar
  Cuando envía GET /files/:id/share-links
  Entonces ve los enlaces con su estado: active, expired o revoked

Escenario 6: Revocar
  Cuando envía DELETE /share-links/:id
  Entonces responde 204 y revoked_at queda registrado
  Y repetirlo también responde 204 sin cambiar la fecha

Escenario 7: Aislamiento
  Dado un archivo o enlace ajeno o inexistente → 404

Escenario 8: Archivo en papelera
  Dado un archivo en la papelera → crear responde 404

Escenario 9: Auditoría
  Entonces crear y revocar registran SHARE_LINK_CREATED y SHARE_LINK_REVOKED, sin token ni contraseña
```

## 5. Contrato de API

| Método y ruta | Entrada | Respuesta |
|---|---|---|
| `POST /files/:id/share-links` | `{ expiresInDays: 1\|7\|30, password? }` | `201 { id, token, versionId, expiresAt, hasPassword, createdAt }` |
| `GET /files/:id/share-links` | — | `{ items: [{ id, versionId, expiresAt, hasPassword, status, createdAt, revokedAt }] }` |
| `DELETE /share-links/:id` | — | `204` |

**Contraseña:** reutilizar la política de `iam/dto/password-policy.ts` solo si no resulta excesiva para un enlace; mínimo 8 caracteres.

## 6. Datos y Esquema

Sin migración. `files.share_link` existe con `uq_share_link_token_hash`, `ck_share_link_expires_after_created` y `ck_share_link_revoked_after_created`.

## 8. Diseño Técnico

- Nuevo `ShareLinksService` y entidad `ShareLink`.
- **Token:** `OpaqueTokens.generate()` y `hash()`; patrón de `password-reset.service.ts`.
- **Exportar de `IamModule`:** `OpaqueTokens` y `PasswordHasher`, que hoy no se exportan.
- **Acceso:** `DriveAccessService.locateFile` (SPEC-221); exige nivel `write` u `owner`.
- **Versión:** `file.currentVersionId`, fija desde la creación (ADR-002 §8).
- **Estado:** calculado: `revokedAt` → `revoked`; `expiresAt <= now` → `expired`; si no, `active`.
- **Riesgos:** registrar el token en logs o auditoría; nunca se incluye. `ValidationPipe` no debe reflejar la contraseña en errores.

## 9. Plan de Tareas

- [x] **T1 (20 min)**: Entidad, DTO y exportaciones.
- [x] **T2 (50 min)**: `ShareLinksService` y controlador.
- [x] **T3 (15 min)**: Acciones y recurso de auditoría (`SHARE_LINK`).
- [x] **T4 (35 min)**: Pruebas.

**Archivos permitidos:** `files/share-links.service.ts`, `files/share-links.controller.ts`, `files/entities/share-link.entity.ts`, `files/dto/share-link.dto.ts`, su spec (nuevos), `files/files.module.ts`, `iam/iam.module.ts` (solo `exports`), `audit/audit.types.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–9 | Unitaria | `share-links.service.spec.ts` |

## 11. Impacto en Documentación

- [x] `CONTRACTS.md` v0.6.
- [x] `ENTS_REGISTRY.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
| 2026-11-06 | Claude Code | Implementada. Pruebas unitarias en `share-links.service.spec.ts` (escenarios 1–9 y `shareLinkStatus`). Decisiones de implementación: la contraseña del enlace tiene política propia (8 a 128 caracteres, sin exigir letras ni números); crear, listar y revocar exigen nivel `write` u `owner` y responden 404 con `read`; revocar funciona con el archivo en papelera. Verificación manual contra la API y PostgreSQL de desarrollo: 30 comprobaciones en verde. Pendiente: la PR. |
