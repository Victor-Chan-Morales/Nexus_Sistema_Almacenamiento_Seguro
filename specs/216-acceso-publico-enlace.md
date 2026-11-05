# SPEC-216: ACCESO PÚBLICO A UN ENLACE COMPARTIDO

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (ruta pública sin sesión) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/` |
| **Requisitos Vinculados** | RF-010, RF-011, RF-012 |
| **Dependencias** | SPEC-209, SPEC-210, SPEC-407 |
| **Prioridad** | P1 |
| **Estimación** | 3 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Permitir que alguien sin cuenta consulte y descargue un archivo con un enlace válido. Es la superficie más expuesta del sistema: nunca revela si un enlace existió.

## 3. Fuera de Alcance

- Vista previa en línea y descarga parcial.
- Pantalla pública (SPEC-217).
- Limitación distribuida (Redis): el monolito usa un contador en memoria.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Enlace sin contraseña
  Cuando un visitante envía GET /public/share-links/:token
  Entonces responde 200 con name, sizeBytes, mimeType, expiresAt y requiresPassword: false

Escenario 2: Enlace con contraseña
  Entonces responde 200 solo con requiresPassword: true y expiresAt, sin nombre ni tamaño

Escenario 3: Descarga
  Cuando envía POST /public/share-links/:token/download
  Entonces recibe los bytes exactos de la versión fija, aunque el archivo tenga versiones más nuevas

Escenario 4: Contraseña
  Dada la contraseña correcta → descarga
  Dada una incorrecta o ausente → 401 SHARE_LINK_PASSWORD_INVALID

Escenario 5: Enlace no disponible
  Dado un token inexistente, vencido o revocado, o un archivo en papelera, purgado o de una organización no activa
  Entonces responde siempre 404 SHARE_LINK_UNAVAILABLE con el mismo cuerpo

Escenario 6: Revocación inmediata
  Cuando se revoca un enlace
  Entonces la siguiente solicitud responde 404

Escenario 7: Fuerza bruta
  Dados 5 intentos fallidos de contraseña en 15 minutos desde la misma IP y enlace
  Entonces responde 429 TOO_MANY_ATTEMPTS, incluso con la contraseña correcta

Escenario 8: Auditoría
  Entonces una descarga registra SHARE_LINK_ACCESSED con actor "visitor" y resultado success
  Y una contraseña incorrecta registra resultado failure
  Y ningún evento incluye token, contraseña ni IP

Escenario 9: Cabeceras
  Entonces la respuesta incluye Content-Disposition seguro, X-Content-Type-Options: nosniff
  y Referrer-Policy: no-referrer

Escenario 10: Sin sesión
  Entonces estas rutas no exigen JWT y las demás rutas de Files siguen exigiéndolo
```

## 5. Contrato de API

| Método y ruta | Entrada | Respuesta |
|---|---|---|
| `GET /public/share-links/:token` | — | `200 { requiresPassword, expiresAt, name?, sizeBytes?, mimeType? }` |
| `POST /public/share-links/:token/download` | `{ password? }` | Bytes |

Errores nuevos: `404 SHARE_LINK_UNAVAILABLE`, `401 SHARE_LINK_PASSWORD_INVALID`, `429 TOO_MANY_ATTEMPTS`.

## 6. Datos y Esquema

Sin migración.

## 8. Diseño Técnico

- **Controlador aparte:** `PublicShareLinksController`, sin `AuthGuard`.
- **Búsqueda:** por `hash(token)`. Nunca por el token en claro.
- **Organización:** sale del enlace, nunca del visitante.
- **Comprobaciones en orden:** existe → no revocado → no vencido → archivo activo con carpeta activa → organización activa. Todas fallan con el mismo error.
- **Bytes:** `FileVersionsService.readVersionBytes` (SPEC-210).
- **Contador:** `Map` en memoria por `linkId + IP`, con caducidad a 15 minutos y limpieza periódica `.unref()`. Se reinicia al arrancar (limitación aceptada de un único proceso). Detrás del proxy, la IP sale de `X-Forwarded-For` únicamente si `TRUST_PROXY=true`.
- **Tiempos:** verificar Argon2 solo si el enlace tiene contraseña.
- **Riesgo:** el token viaja en la URL. Mitigación: `no-referrer`, y el proxy de SPEC-806 no registra rutas `/public/share-links/*` con su valor.

## 9. Plan de Tareas

- [ ] **T1 (50 min)**: Resolver el enlace y metadatos.
- [ ] **T2 (50 min)**: Descarga y contraseña.
- [ ] **T3 (30 min)**: Contador y auditoría.
- [ ] **T4 (50 min)**: Pruebas.

**Archivos permitidos:** `files/public-share-links.controller.ts` y su spec (nuevos), `files/share-links.service.ts`, `files/files.module.ts`, `audit/audit.types.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–9 | Unitaria | `public-share-links.controller.spec.ts` |
| Escenarios 3, 6, 10 | E2E con Postgres y SeaweedFS | `apps/api/test/` |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
