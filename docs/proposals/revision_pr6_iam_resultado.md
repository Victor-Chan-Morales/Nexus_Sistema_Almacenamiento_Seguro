# Revisión técnica de la PR #6 — Módulo IAM · Resultado (v2)

**Fecha:** 2026-10-18 · **Módulo:** IAM · **Revisión de:** `revision_pr6_iam.md`

## Alcance y límites de esta revisión (leer primero)
- **Disponible:** el código entregado en `iam-module.zip` (verificado idéntico a la carpeta de trabajo), los cinco documentos del equipo (`BUSINESS_RULES.md`, `CONTRACTS.md`, `CONTRIBUTING.md`, `SESSION_LOG.md`, `ARCHITECTURE.md`; se citan con número de línea) y lo compartido en la conversación (compose, `main.ts`, `app.module.ts`, salida de `psql`, ejecuciones del script de humo).
- **No disponible:** el repositorio y su estado de Git, la PR #6, `ENTS_REGISTRY.md`, ADR-002/003/004, `docs/modelo-minimo.md`, las migraciones y `apps/web`. Lo que depende de ellos queda **No verificado**. **La PR puede diferir de este código.**
- Los resultados del script de humo (41/41) los ejecutó el autor; no se reproducen aquí.

## Registro de resultados

| # | Hallazgo | Estado | Evidencia / archivos / pruebas | Acción |
|---|---|---|---|---|
| 1 | Contrato de endpoints | **Confirmado** → Pendiente de decisión | El comportamiento está aprobado: verificación de 15 min y un solo uso (`CONTRACTS.md:42`), refresh en cookie `HttpOnly` sin `localStorage` (`:43`; `SESSION_LOG.md:49`). Pero `verify-email`, `refresh` y `logout` (`iam.controller.ts`) no figuran en el contrato y este exige documentar antes de implementar (`:51`); `CONTRIBUTING.md:8` las trata como bloqueadas. Son requisitos del producto final (`BUSINESS_RULES.md:68`), no del 30%. Cookie, hash, rotación y reutilización verificados en código, pruebas unitarias y script de humo del autor | Sin cambios al contrato real. Propuesta en `CONTRACTS.iam-propuesta.diff` (aplica limpio sobre el archivo real). Decisión D1 |
| 2 | Organización activa en refresh | **Confirmado** → Pendiente de decisión | `session.service.ts` usa `findActive(user.id, undefined, tx)`; `iam.session` sin `organization_id`; el login deriva igual. Varias organizaciones por cuenta y sesiones en varios dispositivos están aprobadas (`BUSINESS_RULES.md:86,92`); aún no hay selector. Hoy no cambia nada visible con una membresía | Sin cambios de modelo (esquema compartido, `CONTRIBUTING.md:36`). 2 `it.todo`. Decisión D2 |
| 3 | Hooks Billing/Files | **Confirmado** (incumple reglas aprobadas, a falta de integración) → Pendiente de decisión | `BUSINESS_RULES.md:95`: la creación de usuario, organización, membresía, **suscripción demo y cuota** debe ser atómica; `CONTRACTS.md:45`: el registro crea "Mi espacio" y "Archivos". `registration.service.ts` ejecuta `hooks.run` con la transacción, pero no hay ningún `hooks.register` en el código y `SESSION_LOG.md:15` describe un registro de solo tres entidades. Mecanismo = propuesta de IAM sin aprobación visible | Pruebas nuevas del lado IAM (hooks reciben la transacción; su fallo impide token y correo). Billing y Files: Anthony y Miguel. Decisión D3 |
| 4 | Modelos de token | **No aplica** (código entregado) / **No verificado** (PR) | Ninguna referencia a `EmailVerificationToken`; solo `OneTimeToken` → `iam.one_time_token` con filtro por `purpose`, `FOR UPDATE`, `used_at`, 15 min y hash | Pruebas nuevas del token. Comprobar en el repo (comandos en `iam-decisiones-pendientes.md`) |
| 5 | Migraciones | **No verificado** | Lo entregado no contiene migraciones; entidades ↔ `psql` real: 6 tablas coherentes y todas las `NOT NULL` sin default cubiertas | Sin cambios. Decisión D7 |
| 6 | Cambios globales | **Confirmado** → Pendiente de decisión | `CONTRIBUTING.md:31-32` exige coordinar compose, `package.json` y configuración común; `:40`, justificar dependencias (`argon2` desde la 0.31.2, `nodemailer`). `ARCHITECTURE.md:91-94` lista 3 servicios; el compose unificado añade `mailpit` y `migrate`. Verificados sin problema: prefijo, CORS, `ValidationPipe`, formato de error, `JWT_SECRET` | Sin cambios. Decisión D6 |
| 7 | URL de verificación | **Confirmado** (por documentación) → **Corregido** en código | `SESSION_LOG.md:54`: la web tiene `/verificar-correo`; el correo enlazaba a `/verify-email` (`email.service.ts`, `IAM.md`). Sin `apps/web` no se pudo confirmar que la página lea `token` | Enlace → `/verificar-correo?token=…`, configurable (`IAM_VERIFY_EMAIL_PATH`). Prueba nueva + mutación. Falta confirmar con Víctor (D5) |
| 8 | Fallos SMTP | **Confirmado** (brecha funcional) → Pendiente de decisión | `deliver()` captura el error y registra solo `userId` y el nombre del error; el registro no afirma que se envió. Solo el registro emite tokens (15 min): sin reenvío una cuenta puede quedar sin verificar. Ningún documento define el reenvío | Pruebas nuevas (no lanza; log sin token, correo ni mensaje SMTP). Reenvío: decisión D4 |
| 9 | Rol y estados | **Cumple** (faltaban pruebas) | `BUSINESS_RULES.md:19`: membresía u organización suspendida/cancelada se valida en cada request → `findActive` solo acepta `active` en ambas. `:20`: `is_super_admin` no autoriza (el código solo lo guarda en `false`). `:29-31`: roles `tenant_admin`/`colaborador` y administrador mínimo para quien registra. Auditor no modelado (falta acordarlo) | Pruebas nuevas de estados, rol desde la BD y rol faltante |
| 10 | Pruebas reproducibles | **Confirmado** (parcial) | Faltaban hooks, SMTP, `JwtStrategy`, repositorio, token y enlace | 28 pruebas nuevas; e2e/humo/Jest real bloqueados en este entorno |
| 11 | Artefactos | **No verificado** | Lo entregado: sin `.env`, `.Rhistory`, cookies, respaldos ni claves; sin secretos reales. Posibles restos de las instrucciones previas: `docker-compose.old.yml`, `cookies.txt` (`CONTRIBUTING.md:46`) | Sin cambios. Comandos en `iam-decisiones-pendientes.md` |

## Pruebas ejecutadas (resultados reales)
**Entorno:** sandbox sin Jest, `supertest`, Docker, PostgreSQL ni red. Node 22.22.2, `tsx`, `tsc` 6.0.3.
**Ejecutor:** *no es Jest*. Un ejecutor mínimo propio (`describe/it/it.each/it.todo`, `expect`, `jest.fn/spyOn`) con stubs de `@nestjs/common`, `typeorm`, `passport-jwt`, etc. Las pruebas usan puertos simulados: ejercitan el código real de servicios, estrategia, repositorio y funciones puras; no prueban compatibilidad con Jest ni con TypeORM reales.

| Comando | Resultado |
|---|---|
| `iam.services.spec.ts` (línea base, antes de cambiar nada) | **13 passed**, 0 failed |
| 4 suites (`services`, `registration`, `security`, `email-link`) | **41 passed**, 0 failed, 2 todo (43 total), código de salida 0 |
| Mutaciones (2 sobre la base, 4 sobre las pruebas de la revisión anterior, 1 sobre el enlace) | Las 7 regresiones inyectadas fueron detectadas; restaurado → 41 passed |
| `tsc` con librerías simuladas | Sin errores propios |

**No ejecutado (bloqueado por entorno):** Jest real, e2e (`iam.e2e-spec.ts`), script de humo, `npm run build`, rollback transaccional real contra PostgreSQL, varias organizaciones contra base real, flujo con correo real y la página web de verificación.

## Resumen final
**Hallazgos confirmados:** (1) rutas sin documentar en el contrato; (2) organización no persistida en la sesión; (3) registro sin suscripción demo, cuota ni Drive inicial, contra reglas aprobadas; (6) cambios compartidos sin coordinar; (7) enlace de verificación a una ruta inexistente; (8) sin reenvío de verificación; (9) y (10) faltaban pruebas.
**Cambios implementados:**
- *Modificados:* `constants.ts`, `iam.utils.ts`, `infrastructure/email.service.ts` (enlace de verificación), `docs/modules/IAM.md`, `docs/proposals/iam-env-additions.md`.
- *Nuevos:* `iam.registration.spec.ts`, `iam.security.spec.ts`, `iam.email-link.spec.ts`, `iam-decisiones-pendientes.md`, este documento, `CONTRACTS.iam-propuesta.diff`, `SESSION_LOG.entrada-iam.md`.
- *No se tocó:* contrato real, migraciones, hooks de Billing/Files, `main.ts`, `app.module.ts`, compose ni `package.json`.
**Pendientes de decisión:** D1–D7 (responsables y evidencia en `iam-decisiones-pendientes.md`).
**Cumple sin cambios:** correo normalizado, Argon2id, registro transaccional de las tres entidades, rechazo de `organizationId` del cliente, validación de estados en cada request, `is_super_admin` sin privilegios, roles del diccionario, cookie `httpOnly` y refresh fuera del JSON, hash de tokens, rotación y reutilización, formato de error, MFA con falla cerrada, entidades coherentes con el esquema real.
**Conclusión:** la PR **no está lista para integrar**. Bloquean: D1 (contrato), D3 (suscripción demo, cuota y Drive: reglas aprobadas aún sin cumplir) y D4 (reenvío). Faltan además las comprobaciones en el repositorio (4, 5, 11), confirmar la página web (D5) y la ejecución de Jest, e2e y humo reales.

## Criterios para solicitar nueva revisión
- [ ] Rutas nuevas aprobadas y registradas, o bloqueadas (D1) — **pendiente; propuesta lista**
- [ ] Refresh conserva y revalida la organización, o se documenta por qué no aplica (D2) — **documentado como limitación**
- [ ] Hooks de Billing/Files conectados y probados ante fallos (D3) — **pendiente; lado IAM probado**
- [ ] URL de verificación apunta a una ruta real (D5) — **ruta alineada a `/verificar-correo`; falta confirmar el parámetro**
- [ ] Tokens y migraciones coherentes (hallazgos 4, 5, D7) — **tokens coherentes en el código entregado; migraciones no verificadas**
- [ ] Cambios globales revisados con los responsables (D6) — **pendiente**
- [x] Pruebas documentadas; las bloqueadas, identificadas
- [ ] Artefactos innecesarios retirados (hallazgo 11) — **no verificado**
- [x] Resumen final distingue cambios, pendientes y observaciones sin cambios
