# Bitácora de coordinación

> Las entradas previas a 2026-10-08 documentan el proveedor histórico MinIO; ADR-004 establece SeaweedFS como configuración local vigente.


Registro dinámico de decisiones, acuerdos pendientes y bloqueos. Añada entradas nuevas al principio; no borre historia. Los contratos de integración v0.3 fueron aprobados por el integrador para implementación el 2026-10-18.

## 2026-11-10 — SPEC-116: reenvío del correo de verificación

- [x] Chrome en `/verificar-correo` sin token. Un correo mal formado mostró «Escribe un correo válido.» y no llamó a la API. Durante la solicitud el botón mostró «Enviando…» y quedó deshabilitado.
- [x] Escenario 11. El reenvío real devolvió la confirmación genérica y mostró «Reenviar en 120 s». Se adelantó el reloj del navegador 120 segundos y el botón volvió a habilitarse.
- [x] Escenario 12. Al interrumpir la conexión con la API desde Chrome, apareció «No pudimos conectar. Intenta de nuevo.» y el botón quedó activo.
- [x] Mailpit recibió un enlace distinto para una cuenta de prueba. El anterior fue rechazado, el nuevo verificó el correo y el login funcionó después.
- El contrato v0.7 documenta la ruta de reenvío. El escenario 10 conserva el código HTTP 403 de login del contrato vigente.
- [Capturas y resultados de SPEC-116](docs/evidencia/spec-116/README.md).

## 2026-11-10 — SPEC-305: pago simulado con tarjetas de prueba

- **Estado:** Implementada y verificada en `feat/305-pago-simulado-tarjetas` (desde `main`), lista para PR. La documentación se alinea con el plan: `CONTRACTS.md` en v0.6 (`payment` opcional en `activate`, cuerpo opcional `{ payment }` en `renew`, `cardLast4` en `GET /billing/operations`, errores 402 `PAYMENT_DECLINED` y 422 `TEST_CARD_REQUIRED`, subsección «Pago simulado»), `BUSINESS_RULES.md` (rechazo 402 y planes gratuitos) y el README de billing (`card_last4`). El código (migración `card_last4`, `PAYMENT_DECLINED` en auditoría, formulario de tarjeta) se verifica antes de abrir la PR; SPEC-407 ya estaba en `main`.
- **Decisiones (plan, default aplicado):**
  - D1 (resuelto): la auditoría de `result = failure` la habilita SPEC-407, ya fusionada en `main`.
  - D2: orden en `activate`: idempotencia → cuota (422) → pago requerido (400) → validación de campos (400) → tarjeta de prueba (422) → simulación (402).
  - D3: vencimiento o CVV inválidos responden `400 VALIDATION_ERROR`; `PaymentResult` conserva sus tres estados.
  - D4: un número distinto de las dos tarjetas fijas responde `422 TEST_CARD_REQUIRED`; el DTO no valida el formato del número.
  - D5: en un plan de US$0, `payment` se ignora (no se valida ni se guarda) y `card_last4` queda en `NULL`.
  - D6: `PAYMENT_DECLINED` se audita en el controlador, después del rollback, con `result: failure`; `logEvent` no lanza.
  - D7: rechazo al activar o cambiar plan redirige a `/suscripcion/fallida?plan=…&motivo=tarjeta`.
  - D8: rechazo al renovar muestra un aviso en línea dentro de la tarjeta de suscripción, sin redirección.
  - D9: al renovar, el formulario se muestra siempre al pulsar «Renovar»; el backend ignora `payment` en planes gratuitos.
  - D10: `BillingService.subscribe()` (sin llamadores de producción, salta el pago) se elimina salvo que un spec lo necesite; si lo necesita, rechaza planes con precio mayor que 0.
  - D11: `holderName` es texto de 1 a 100 caracteres, sin más reglas.
  - Abiertas, sin cambios aplicados: D12 (partir la PR si el diff supera 400 líneas) y D13 (responsable de `billing/**`: `ENTS_REGISTRY.md` dice Anthony, `Orden de ejecucion specs` dice Víctor).
- **Verificación (2026-11-10):**
  - `npm run test:api`: 60 suites y 1 002 pruebas en verde (baseline de `main`: 58 suites y 936 pruebas). `build:api` y `build:web` correctos; `lint:web` sin errores.
  - Migración `20261110090000_add_billing_operation_card_last4`: up, down y up verificados en una base temporal.
  - Prueba de humo contra la API real y una base temporal: 12 casos (aprobada, rechazada, otra tarjeta, sin tarjeta, vencimiento, CVV, reactivación, renovación rechazada y aprobada, historial, plan gratuito). Ninguna respuesta, log ni tabla contiene el número de tarjeta, el titular ni el CVV.
  - Capturas del escenario 10 en escritorio y móvil (390 px): `docs/evidencia/spec-305/RESUMEN.md`.
- **Corrección posterior:** reactivar el plan vigente ya no muestra el formulario (commit `abff87a`). La suscripción vigente sale de `GET /dashboard`.
- **Pendiente:**
  - D12 (tamaño de la PR): se abre una sola PR con excepción explícita al límite de 400 líneas, por las pruebas del backend. Víctor debe aceptarla al revisar.
  - Coordinación con SPEC-503 en `CONTRACTS.md` y `SESSION_LOG.md`: las ediciones se hicieron en líneas nuevas o en secciones propias. Si 503 fusiona antes, hay que rebasar y repetir la suite completa.

## 2026-11-06 — SPEC-804: pantalla de almacenamiento y segundo S3 (T1 a T4)

- Se implementó SPEC-804 en `feat/804-frontend-almacenamiento` en tres commits: `c1ad403` (segundo S3 con el perfil `s3-local`, `.env.example` y guía), `746a42c` (cliente, pantalla `/almacenamiento`, cambio de modelo y gestión de destinos) y `c8f00e0` (selector de destino y etiqueta de ubicación en el explorador).
- Verificación en navegador headless (Playwright, en local) contra la API y la web reales: pantalla del administrador, selector del explorador en modelo híbrido, etiquetas de ubicación, diálogo de cambio de modelo sin confirmar y vista del colaborador en solo lectura (sin llamadas a `/destinations`). Detalle y lo no comprobado en `docs/evidencia/spec-804/RESUMEN.md`.
- Corrección de la spec §8: el destino de la API en el equipo se registra con la IP de la LAN; `localhost` lo bloquea SPEC-802.
- Decisiones: el selector de destino en "Crear carpeta" solo aparece en la raíz de un Drive con modelo híbrido, y el botón queda deshabilitado hasta elegir. La pantalla recarga en silencio tras cambios para no borrar mensajes de "Probar conexión".
- Pendiente: cotejo visual con el diseño (espacio vacío sobre los títulos de las tarjetas); los escenarios 2 y 7 no se recorrieron con clics en la interfaz; el comando de AWS CLI de la guía no se ejecutó (la creación del bucket se hizo con el SDK).

## 2026-11-06 — SPEC-803: elegir Nube, Local o Híbrido (T1 a T4)

- Se implementó SPEC-803 en `feat/803-elegir-modelo-despliegue` en tres commits: `1d959a1` (base: modelo de despliegue en IAM, `DestinationDefaults`, auditoría), `d38ccfa` (destino de carpetas por modelo) y `32f6b28` (política de almacenamiento y solicitudes de instalación). Sin migración.
- Prueba manual con dos S3 (`docs/evidencia/spec-803/RESUMEN.md`): los 12 escenarios se comprobaron contra la API, salvo el destino deshabilitado del 10, que tiene prueba automática (la evidencia lo indica). El segundo almacén se registró por la IP de la LAN; `localhost` sigue bloqueado por SPEC-802, lo que corrige la indicación de SPEC-804 §8.
- Decisiones: Files lee el modelo por el puerto `DeploymentModelSource` (no importa IAM); `IamModule` exporta `OrganizationRepository`. Una sola solicitud pendiente por organización se garantiza con `lockById` dentro de la transacción, sin índice nuevo. El cambio de predeterminado repunta las raíces de todos los Drives, personales y de equipo.
- Pendiente: el código de la rama (sin specs) suma unas 865 líneas, por encima del límite de 400 de `REGLAS.md` §4. La partición que prevé el plan no es limpia: la política depende de que la base de Files registre `DestinationDefaults`. Decide Víctor cómo abrir el PR.
- Pendiente de SPEC-503: revisión de solicitudes (cambio de estado y operador asignado). Pendiente de SPEC-804: pantalla `/almacenamiento` y segundo S3 en Compose.

## 2026-10-31 — Pantalla de auditoría conectada (SPEC-403)

- **Estado:** `/auditoria` deja el `PlaceholderPage` y muestra la bitácora real (`apps/web/src/components/audit-log.tsx`) contra `GET /audit/events` (SPEC-402) mediante el cliente `apps/web/src/lib/api/audit.ts`. Tabla con fecha, actor, acción en español con insignia por familia (`.audit-badge-{auth,files,team,plan}` en `globals.css`) y recurso; filtro visual por acción, "Cargar más" por cursor, estados de carga/vacío/error y aviso para `colaborador` sin llamar a la API. Rama `feat/403-frontend-auditoria` **apilada sobre `feat/106-frontend-miembros-configuracion` (PR #29)**; se rebasará sobre `main` cuando #29 entre.
- **Decisiones:** `Notice` se extrajo a `apps/web/src/components/notice.tsx` para reutilizarlo entre `/configuracion` y `/auditoria`. El actor se resuelve con el `userId` de la lista de miembros (SPEC-104/106); si no aparece, se muestra "Usuario". Es solo presentación: no se autoriza nada en el cliente.
- **Límites declarados:** la fecha se muestra sin hora (`formatIsoDate`); el cursor es el `occurredAt` que define SPEC-402, por lo que eventos con el mismo instante podrían omitirse en el borde de página (limitación aceptada en SPEC-402).
- **Pendiente:** hasta que se mergeen 405-T1 (IAM) y 405-T3 (Billing) solo aparecen eventos `FILE_*`; cotejo visual sin frame específico; verificación manual de los escenarios 1–5.

## 2026-10-27 — Revisión de specs y decisiones del corte del 80%

- **Estado:** specs 101–601 reescritas y en revisión; `CONTRACTS.md` pasa a **v0.5 (borrador, pendiente de aprobación del coordinador)**. Decisiones registradas en `docs/decisions/ADR-007-decisiones-corte-80.md`; enmienda a ADR-003 (purga por el dueño; reset revoca sesiones).
- **Qué cambió respecto de las specs originales:** rol `colaborador` (no `collaborator`); papelera de solo archivos y por Drive personal; auditoría con hash desde la v1 y hooks por dueño; SPEC-302 pasa de "cambio" a **renovación**; SPEC-107 se absorbe en SPEC-103; numeración RF de la propuesta como única canónica.
- **Pendiente:** el coordinador aprueba `CONTRACTS.md` v0.5 y las specs; migración del outbox de correo (`password_reset`, `member_invitation`) a cargo del integrador; confirmar horas reales por persona (el plan P1 estima ~8–9 h por persona frente a las ~5 h previstas).
- **Seguimiento (misma fecha):** capacidad confirmada en **~7 h por persona**; la papelera completa (202–205), versiones y perfil pasan a P2 y el reparto cambia (ver `docs/equipo/asignaciones.md`). Creada y **verificada contra Postgres 16** la migración `20261027090000_allow_password_reset_outbox_kinds.sql` (up, down y re-up; las 17 migraciones previas también aplican en orden). **ADR-006 corregido** (jerarquía de llaves real, formato del objeto, sin columnas `iv`/`auth_tag`; declara que no hay rotación de llaves ni pruebas dedicadas) y `ARCHITECTURE.md` / `BUSINESS_RULES.md` alineados.
- **Borradores SPEC-701/702 (misma fecha):** `docs/entregables/REQUISITOS_CASOS_USO.md` (RF-001…016, RNF, 23 casos de uso, trazabilidad) y `docs/entregables/DIAGRAMAS_UML.md` (13 diagramas Mermaid validados con el parser). Pendientes de revisión de Víctor. Al redactarlos se detectaron: (1) `readStorageUsage` deja de contar los archivos eliminados pasados 30 días aunque sigan almacenados (corregido el texto de ADR-007 §7 y CONTRACTS v0.5); (2) la unicidad de nombres de carpeta por padre que exige ADR-003 **no está implementada** ni en API ni en BD; (3) `npm run infra:up` no levanta Mailpit.
- **REGLAS.md corregido y scripts añadidos (misma fecha):** `REGLAS.md` ahora refleja el repo (Next 16 / React 19, CSS propio sin Tailwind ni Lucide, dbmate para migraciones, `tsconfig` sin `strict`, sin comandos `/spec` ni agentes, aviso de que `infra:up` no levanta Mailpit). Añadidos `test:api` y `test:cov` al `package.json` raíz (verificados: 79/79 pruebas, filtro por patrón y cobertura ~51 % de líneas; `files-crypto.service.ts` 13 %, `files.controller.ts` 0 %). ADR-006 cita la cobertura medida.
- **Gobernanza alineada con el repo (misma fecha):** (1) `docs/sdd/constitucion.md` ya no cita `StorageProvider`/`STORAGE_PROVIDER`/`SeaweedfsStorageProvider` (no existen: `FilesService` inyecta la clase `StorageService`), ni `docs/CONTRACTS.md` (está en la raíz); la misma afirmación falsa se corrigió en `ARCHITECTURE.md`, `ENTS_REGISTRY.md` y `CONTRIBUTING.md`. (2) Plantillas de PR fusionadas en una sola, `.github/pull_request_template.md`; la original en mayúsculas se eliminó (queda como `D` en git). El *handle* del coordinador era `@VictorMorales` (otra cuenta) y pasó a `@Victor-Chan-Morales`. (3) Formato de rama unificado en `feat/<ID>-<slug>` / `fix/<ID>-<slug>` (`docs/sdd/flujo.md` y `CONTRIBUTING.md`); las ramas `feature/<persona>/<tema>` existentes no se renombran. Deuda anotada en la constitución: `apps/web/src/lib/plans.ts` hardcodea el catálogo de planes (landing, `/planes`, vistas demo) aunque el art. 4 lo prohíbe.
- **Sin ejecutar:** ningún cambio de código de `apps/`. El resto son documentos, la migración y los scripts de `package.json`.

## 2026-10-18 — Integración de la PR #6 (IAM) en main, cerrada por el integrador

- **Estado:** integrada en `integration/pr6-iam` (merge de `main` + `Sebastian_S` sin devolución pendiente). Ya no hay bloqueantes abiertos de IAM.
- **Conflicto resuelto:** `SESSION_LOG.md` era el único choque con `main` (ambas ramas escribieron entradas del 2026-10-18 y `main` reescribió el párrafo de intro). Se conservó el texto de `main` y la entrada de IAM completa.
- **Decisión del integrador — hooks de alta:** Billing y Files ya registran los hooks que el registro exige. `DemoSubscriptionHook` (`modules/billing/registration`) contrata el plan `Demo` y `PersonalDriveHook` (`modules/files/registration`) crea el Drive `Mi espacio`, la carpeta raíz `Archivos` y la fila de `files.tenant_quota` en cero. Ambos escriben con el `EntityManager` de la transacción del registro y, por ahora, con SQL contra el esquema canónico: las entidades de esos módulos todavía apuntan al esquema plano anterior (`plans`, `folders`, `file_records`) y las reemplazarán sus propios PR.
- **Decisión del integrador — catálogo de planes:** el catálogo aprobado (Demo, Team, Business, Enterprise) pasa a datos de referencia en `database/migrations/20261019090100`, con `name` único, porque sin el plan Demo el alta de cualquier organización falla. El seed de desarrollo ya no define planes propios: resuelve la suscripción de prueba por nombre.
- **Aclaración de contrato (`CONTRACTS.md`):** si el token de verificación de 15 minutos vence mientras el SMTP está caído, el reintento de la outbox emite uno nuevo antes de enviar; los reintentos se abandonan a las 24 horas. Antes la cuenta quedaba creada, sin enlace utilizable, con el login bloqueado por `EMAIL_NOT_VERIFIED` y sin reenvío manual. No se agregó ninguna ruta: sigue sin existir endpoint de reenvío.
- **Configuración unificada:** `WEB_URL` es la única variable de origen de la web (CORS y enlace del correo); se eliminó `APP_URL`. En `docker-compose.yml` se conservan los nombres `nexus-*` y el volumen `nexus-postgres-data`, para que nadie pierda su base local, y se mantienen los servicios nuevos `mailpit` y `migrate` (dbmate, perfil `tools`).
- **Verificado el 2026-10-18 contra PostgreSQL 16 real:** 53 pruebas unitarias y 13 e2e en verde; `npm run build` de la API correcto; las 16 migraciones aplicadas en orden sobre una base sin el esquema canónico, y `down` + `up` de las tres últimas comprobados en una base desechable. El e2e ya corre con los hooks reales e incluye el rollback completo del alta cuando un hook falla y la renovación del token tras una caída de SMTP.
- **Pendiente, fuera del alcance de esta PR:** Billing (PR #4) y Files (PR #5) siguen sirviendo sus endpoints contra las tablas planas del esquema anterior, que ninguna migración crea; con `DB_SYNCHRONIZE=false` (ahora el valor por defecto) `GET /plans`, `/folders` y la carga de archivos no funcionan hasta que cada módulo se alinee con `database/migrations`. El registro sí funciona completo.

## 2026-10-18 — Correcciones IAM según la devolución de la PR #6

- **Estado:** Implementado en `Sebastian_S`; pendiente de verificación con PostgreSQL real.
- **Decisiones:** se mantiene la v0.4 de `CONTRACTS.md` (incluye `EMAIL_NOT_VERIFIED`). Outbox completa de correo. La consolidación de migraciones la hace el integrador (Víctor).
- **Implementado:**
  - Cookie `nexus_refresh` (antes `nexus_rt`).
  - `iam.session.organization_id`: el refresh conserva la organización y revalida su membresía; si ya no está activa, rechaza la sesión.
  - Hooks obligatorios `demo-subscription` (Billing) y `personal-drive` (Files): si falta alguno, el registro falla y se revierte. **Hasta que Billing y Files los registren, el registro falla en la aplicación integrada.**
  - Outbox `iam.email_outbox`: el mensaje se escribe en la transacción del registro, se envía después del commit y se reintenta con espera creciente hasta que el token venza. El token va cifrado y el payload se borra al enviar o vencer. Si cambia `JWT_SECRET`, los mensajes pendientes vencen sin enviarse.
  - Configuración: `WEB_URL` como único origen; `exposedHeaders: Content-Disposition`; un solo `JWT_SECRET`; sin `WEB_ORIGIN` ni `JWT_EXPIRES_IN`; volcado de consultas de TypeORM desactivado salvo `DB_LOGGING=true`.
  - Documentación: eliminados los `.Rhistory` y las propuestas v0.2 de `docs/proposals`; `revision_pr6_iam_resultado.md` rotulado como análisis preliminar.
- **Verificado:** jest unitario 52/52; e2e IAM 11/11 contra PostgreSQL 16 limpio con todas las migraciones aplicadas en orden (incluido el escenario de SMTP caído y reintento de la outbox). La migración `down` de `20261019090000` no se ha probado.
- **Pendiente:** Billing (`demo-subscription`) y Files (`personal-drive`) deben registrar sus hooks; hasta entonces el registro falla en la aplicación integrada. Miguel debe mover sus migraciones de `apps/db/` a `database/migrations/` al integrar su PR (consolidación del integrador).
## 2026-10-19 — Correcciones del integrador sobre PR #4 (Billing)

- **Estado:** aplicado por Víctor (integrador) sobre `feature/anthony/billing-demo`. Verificado con PostgreSQL 16.
- **Corregido:**
  - La cuota insuficiente en un cambio de plan responde `422 STORAGE_QUOTA_EXCEEDED` en lugar de `409`. `CONTRACTS.md` reserva `409` para conflictos de estado; el `409` por colisión del índice único se mantiene.
  - Las reservas de carga dejaron de ser código muerto: `uploadFile()` reserva antes de validar y libera en `finally`, así dos cargas simultáneas se cuentan entre sí. La cuota excedida al cargar pasó de `403` a `422 STORAGE_QUOTA_EXCEEDED`.
  - La migración no era ejecutable por ninguna vía: dbmate ignora los `.ts` y Node no resuelve `typeorm` fuera de `apps/api`. Se movió a `apps/api/src/migrations/` y ahora corre con `npm run migration:run`.
  - La migración ya no siembra el catálogo. Única fuente de valores: `BillingService.seedDefaultPlans()`. Esto también elimina un `ON CONFLICT ("name")` que dependía de una restricción única inexistente.
  - Filtro de excepciones movido de `shared/filters/` a `common/filters/`, la misma ruta que usa IAM, para que la integración tenga un solo archivo.
  - `synchronize` vuelve a leer `DB_SYNCHRONIZE`, como `main` e IAM, en lugar de `TYPEORM_SYNC`.
  - Revertido `apps/web/next-env.d.ts`, que es un archivo generado.
- **Verificado:** `tsc` y `nest build` sin errores; Jest 25/25, con 5 pruebas nuevas de cuota y reservas, incluida una de cargas simultáneas. Migración aplicada en base limpia y en base con 3 suscripciones vigentes de la misma organización: quedó 1 activa (la más reciente) y 2 `cancelled`, los nombres legados se renombraron y el índice único se creó sin fallar. El `down` también se probó. El índice rechaza una segunda activa con `23505`.
- **Propiedad:** `SubscriptionCoordinator` lo implementó Anthony, aunque `CONTRACTS.md` lo asigna al integrador. Se acepta la implementación y se registra el cambio en `ENTS_REGISTRY.md`, según `CONTRIBUTING.md`. Víctor ya no lo implementa por separado.
- **Pendiente antes del merge:**
  1. **Conexión con el registro.** Anthony conectó Billing haciendo que `IamModule` importe `BillingModule` y modificando `iam.service.ts`. En `Sebastian_S` ese archivo ya no existe: IAM se reestructuró con `RegistrationHooks`. Como IAM se integra primero, al rebasar hay que registrar el hook `demo-subscription` que llame a `provisionInitialSubscription(orgId, manager)`, que ya está implementado. No puede hacerse antes porque `RegistrationHooks` no existe en la base de esta rama.
  2. **Reservas persistentes.** El almacén de reservas vive en memoria del proceso: no cubre varias instancias ni sobrevive a un reinicio. Files (Miguel) debe reemplazarlo por una tabla en PostgreSQL.
  3. **Esquema divergente (decisión del integrador).** Las migraciones SQL canónicas describen el MER v3 (`billing.plan`, `storage_limit_gb`), pero las entidades de la API usan otro esquema (`plans`, `storage_limit_bytes`). Afecta a los cuatro módulos, no solo a Billing. Hay que decidir cuál es el esquema real antes de consolidar `database/migrations/`.
  4. `plans."storageLocation"` quedó en camelCase mientras el resto de columnas usa snake_case.

## 2026-10-18 — Cierre de observaciones de PR #4 (Billing) y alineación con CONTRACTS.md v0.3

- **Estado:** Implementado, refactorizado y validado con 100% de pruebas unitarias y compilación limpia.
- **Responsable:** Anthony (Billing) en coordinación con Víctor (Integración).
- **Acciones ejecutadas:**
  1. **Alineación de Catálogo y Decimales:** Catálogo oficial aprobado sincronizado con nombres canónicos (`Demo`, `Team`, `Business`, `Enterprise`) y capacidades decimales exactas en bytes: Demo (`5000000000`), Team (`100000000000`), Business (`500000000000`), Enterprise (`2000000000000`). Demo permanente con `validityDays = null` y `priceCents = 0`.
  2. **Depuración de Rutas de API:** Retirada la ruta no consumida `GET /billing/subscription`. `BillingService.getSubscription(organizationId)` provee exclusivamente la suscripción vigente activa (o `null`), omitiendo historial de canceladas y vencidas.
  3. **Formato Canónico de Errores:** Implementado y registrado globalmente `ApiExceptionFilter` emitiendo estrictamente el contrato `{ code, message, requestId }`.
  4. **Cero Dependencias Dinámicas (Eliminación de ModuleRef):** Eliminado definitivamente `ModuleRefStorageUsageAdapter` y el puerto de acoplamiento dinámico. `BillingModule` queda desacoplado de `FilesModule`.
  5. **SubscriptionCoordinator en Capa de Integración:** Creado `SubscriptionCoordinator` fuera del dominio de Billing para orquestar `POST /subscriptions/activate`. Consulta a `FilesService` el total de almacenamiento (todas las versiones retenidas + papelera en 30 días) más las reservas de carga activas. Con comportamiento de falla segura: si Files falla, aborta la transacción inmediatamente y nunca asume 0 bytes.
  6. **Concurrencia, Transacciones y Bloqueo Pesimista:** Activación envuelta en transacción atómica de TypeORM con `lock: { mode: 'pessimistic_write' }` para evitar lecturas desactualizadas y carreras. Idempotencia completa ante llamadas repetidas del mismo plan.
  7. **Manejo Controlado del Índice Único Parcial:** Captura específica del error de colisión de PostgreSQL `23505` (`uq_active_org_subscription`), devolviéndolo como `409 Conflict` (`CONCURRENT_SUBSCRIPTION_CONFLICT`) sin caídas del servidor.
  8. **Consolidación de Migraciones en database/migrations/:** Reubicada la migración desde `apps/api/src/migrations/` a `database/migrations/1729267200000-AlterPlanAddDescriptionAndValidityDays.ts`. Incorpora normalización determinista con funciones de ventana (`ROW_NUMBER()`) para garantizar un solo registro `active` por tenant antes de crear el índice. Creado `src/data-source.ts` y scripts `npm run migration:run` para ejecución explícita en pipeline sin depender de `synchronize: true`.

## 2026-10-18 — Contrato IAM v0.4: bloquear login sin correo verificado

- **Decisión del integrador:** `POST /auth/login` valida primero las credenciales. Si son correctas pero el correo no está verificado, responde HTTP `403` con `code: "EMAIL_NOT_VERIFIED"` y no emite tokens ni cookie de refresh.
- **Motivo:** el frontend ya muestra un mensaje específico para este código; el contrato v0.3 definía el envío y consumo del enlace, pero no fijaba el comportamiento del login antes de verificarlo.
- **Alcance:** aclaración de contrato para implementación de IAM por Sebastián. No se agregan rutas nuevas; no se ofrece reenvío manual del correo en este corte.

## 2026-10-18 — Correcciones documentales para PR #4, #5 y #6

- Se actualizaron las devoluciones individuales de Anthony (Billing), Miguel (Files/Storage) y Sebastián (IAM) para que cada responsable implemente directamente contra `CONTRACTS.md` v0.3 aprobado.
- Se dejaron explícitos el uso del mismo `EntityManager` en los hooks de registro, las rutas y respuestas canónicas de Files, y la ubicación única de migraciones en `database/migrations/` en la raíz.
- Se cerró el comportamiento de correo: el registro persiste el mensaje en una outbox dentro de su transacción; SMTP se procesa después del commit y los fallos temporales se reintentan. También se aclaró qué debe probarse respecto del rollback de hooks y los reintentos de correo.
- **Alcance:** cambios solo de documentación. No se modificó código ni se ejecutaron pruebas.

## 2026-10-18 — Contratos v0.3 y comienzo de correcciones de integración

- **Decisión:** `CONTRACTS.md` v0.3 y el anexo de ADR-003 fijan los contratos de sesión IAM, catálogo/cuota, Files, Dashboard y alta transaccional. Aprobados por Víctor como integrador para que cada PR implemente la misma interfaz.
- **Reglas aclaradas:** unidades decimales en bytes; Demo de 5 GB/5 usuarios sin vencimiento; cuota cero si falta una suscripción; el uso cuenta todas las versiones retenidas y papelera durante 30 días; reducción de plan considera carga confirmada y reservas.
- **Arquitectura acordada:** Dashboard toma organización del principal JWT validado. Un `SubscriptionCoordinator` de integración consulta Files y delega persistencia a Billing, evitando dependencia circular entre Billing y Files.
- **Código iniciado:** Dashboard dejó de inyectar `IamService`; Files calcula uso a partir de `FileVersion` e incluye archivos en papelera; web implementa sesión en memoria, Dashboard y explorador conectados a clientes API, y usa bytes decimales.
- **Pendiente de módulo:** IAM debe publicar `organizationName` y el contexto de membresía en `req.user`, más las rutas/cookie de v0.3. Billing debe implementar límites/ciclo de plan y Demo. Files debe alinear rutas/DTO, carga y descarga, y agregar reservas atómicas; por ello el explorador ya consume el contrato pero aún no completa el flujo con la API local.
- **Verificación:** `npm run build:web` y `npm run build:api` terminaron correctamente el 2026-10-18. No se ejecutaron pruebas automatizadas ni se afirma validación funcional.

## 2026-10-17 — Revisión del avance de integración de Víctor

- **Punto actual:** integración frontend/API sobre `feature/victor/frontend-integration-50`. Se conservaron los cambios locales sin commit.
- **Avance presente en el árbol de trabajo:** sesión web en memoria, guardas bajo `AppShell`, login/registro conectados, planes y suscripción consultando Billing, Dashboard conectado a `GET /api/dashboard`, módulo Dashboard que agrega IAM/Billing/Files in-process usando el tenant del JWT y `recentActivity: []`. CORS expone `Content-Disposition`.
- **Pendiente de verificación:** no se ejecutó el flujo navegador → API → SeaweedFS ni se comparó el archivo descargado con el original. Tampoco se verificaron visualmente las pantallas ni el aislamiento entre organizaciones. La presencia de código no cuenta como evidencia de ejecución.
- **Bloqueos de contrato/API:**
  - La web invoca `POST /auth/verify-email`, `POST /auth/refresh` y `POST /auth/logout`; IAM solo implementa registro, login y `GET /auth/me`. La sesión no se restaura tras recargar y login no establece cookie HttpOnly.
  - El cliente Files sigue el contrato documentado (`/folders`, `/folders/:id/items`, `/files/upload`, descarga binaria), pero el controlador expone listado bajo `/files`, carpetas bajo `/files/folders` y descarga como URL JSON prefirmada. No hay endpoint de carga multipart.
  - Billing sí ofrece `GET /plans` y `POST /subscriptions/activate`; Dashboard consume servicios de módulos directamente.
- **Siguiente paso:** acordar con los responsables de IAM y Files las rutas, campos y respuestas; luego alinear `CONTRACTS.md`, controladores y clientes web. Verificación de correo, persistencia de sesión tras recarga y flujo real de Files siguen pendientes. Recuperación de contraseña y varias vistas de archivos continúan usando datos locales y deben identificarse como prototipo.
- **Ejecución registrada:** revisión estática de planes, contratos, árbol de trabajo, clientes web y controladores/servicios backend. No se ejecutaron pruebas ni se afirma validación funcional.
## 2026-10-06 — Adopción e Implementación del Monolito Modular

- **Estado:** Aprobado e Implementado.
- **Motivo y Decisión:** Para garantizar la entrega del proyecto a final de mes y eliminar la complejidad innecesaria de microservicios distribuidos, el equipo aprobó migrar el backend hacia un **Monolito Modular** en NestJS (`apps/api`).
- **Implementación Técnica Realizada:**
  - `apps/api`: Implementación completa de NestJS con TypeScript (`tsconfig.json`, `nest-cli.json`, `package.json`, `Dockerfile`). Compilación exitosa con `nest build`.
  - Módulos creados e integrados in-process:
    - **IAM** (`src/modules/iam`): Registro atómico (usuario, org, membresía), login con hashing Argon2id, JWT con claims de tenant y endpoint `GET /auth/me`.
    - **Billing** (`src/modules/billing`): Catálogo de planes, suscripción simulada y cálculo de límite de cuota exportado para inyección.
    - **Files** (`src/modules/files`): Manejo de carpetas, metadatos de archivos, control de versiones (`FileVersion`), validación de cuota y URLs prefirmadas de descarga.
    - **Storage** (`src/modules/storage`): Integración MinIO/S3 con patrón Strategy.
    - **Health** (`src/modules/health`): Diagnóstico y ping a PostgreSQL con `@nestjs/terminus` en `/api/health`.
  - Inyección de dependencias interna: `FilesService` inyecta directamente `BillingService` y `StorageService` en memoria sin sobrecarga de llamadas HTTP interservicios.
  - Orquestación (`docker-compose.yml`): Servicio único `api` (puerto 3001) junto a `postgres` (5432) y `minio` (9000/9001).
  - Frontend (`apps/web`): Corre como proceso independiente en el puerto 3000 consumiendo la API mediante los contratos aprobados en `CONTRACTS.md`.
  - Documentación unificada: Se actualizó `README.md`, `ARCHITECTURE.md`, `ADR-001`, `SESSION_LOG.md` y los READMEs de cada módulo para evitar confusiones en el equipo.

## 2026-09-28 — preparación inicial del repositorio

- **Estado:** borrador preparado; falta crear/publicar el repositorio GitHub y revisión del equipo.
- **Alcance:** estructura monorepo, rutas Next.js base, documentación de agentes, reglas de negocio y contratos propuestos para el flujo de 30%.
- **Dueño frontend:** Víctor implementará el frontend común y las pantallas de todos los módulos, siguiendo la indicación más reciente del usuario. Sebastián, Miguel y Anthony implementan sus dominios de API y entregan a Víctor contratos, campos, estados y errores. Esto actualiza la distribución anterior que repartía algunas pantallas entre integrantes.
- **Figma:** no se adjuntaron frames en este turno. Las rutas web son estructura de trabajo, no una transcripción aprobada de las pantallas. Pendiente completar ID/frame, campos, estados y capturas en `docs/FIGMA_MAP.md`.
- **Stack:** los PDFs indican Next.js, NestJS, PostgreSQL 16, Redis Streams, MinIO/S3, libsodium y Docker. Este scaffold inicializa la web; la API y otros módulos siguen pendientes de implementación. No se cambian requisitos del producto final.
- **Decisiones históricas del scaffold:** contratos v0.1, verificación de correo en demo, ADR de despliegue, matriz de roles, límites de carga y plan semilla quedaron sujetos a la revisión del equipo; las reglas de modelo y alcance se consolidan en ADR-002.
- **Bloqueo externo:** el conector GitHub disponible no ofrece una acción para crear repositorios. La carpeta local está lista; publicación remota requiere habilitar la creación mediante el flujo de GitHub adecuado.

### Plantilla para la próxima reunión

- Fecha / participantes:
- Decisiones aprobadas (incluya ID de ADR o versión de contrato):
- Dudas y dueño de resolverlas:
- Cambios de asignación:
- Próximas acciones y fecha:

## 2026-09-29 — Decisiones aprobadas de modelo y alcance

Se aprobaron las reglas revisadas para organizaciones, membresías, archivos, versiones, destinos, cuotas, equipos, permisos, sesiones, enlaces compartidos, auditoría e instalaciones. Se confirma que MFA/TOTP queda fuera del alcance actual por limitación de tiempo y se mantiene únicamente como mejora futura. La referencia consolidada está en `docs/decisions/ADR-002-reglas-aprobadas-modelo.md`.

## 2026-09-29 — cierre de aclaraciones operativas

Se aprobaron las propuestas 1 a 12: correo mediante EmailService, sesiones con access/refresh token, límites de archivos y cuota, Drive inicial, cambios de plan, rol Auditor, nombres y versiones, papelera, auditoría, instalación, contrato API y restricciones ER/migraciones. La consolidación está en `docs/decisions/ADR-003-detalles-operativos-aprobados.md`.
# Interfaz web de demostración — 2026-09-29

- Se analizaron los documentos de arquitectura, reglas, contratos, propiedad, identidad visual, decisiones operativas y el plan individual de Víctor.
- La base web ahora contiene landing, formularios de autenticación simulados, dashboard, planes y explorador con carpetas/metadatos de muestra, más papelera, configuración y auditoría iniciales.
- Se añadieron `/verificar-correo`, `/recuperar-contrasena` y `/archivos/[folderId]` junto con el resto de las rutas solicitadas.
- Los datos de muestra están aislados en el almacén local de demostración y las pantallas indican explícitamente que no están conectadas a API. La selección de archivo solo agrega metadatos; no carga contenido a MinIO.
- Se usa el límite Demo aprobado de 5 GB/5 usuarios; no se inventan precios o planes comerciales.
- Las pantallas restantes siguen pendientes de identificar/cotejar con sus frames correspondientes.
- Login: se revisó `docs/figma/acceso/mk_01_login.png` y se reemplazó el formulario de correo/contraseña por el selector de espacio de trabajo del frame. El inicio sigue simulado; la seguridad y el subdominio aún no se validan con IAM.

## 2026-10-08 — Migración local de almacenamiento S3 a SeaweedFS

- Se reemplazó el contenedor MinIO por SeaweedFS con gateway S3 en Compose.
- El módulo Storage usa AWS SDK for JavaScript v3 y variables S3_*; PostgreSQL sigue almacenando metadatos y SeaweedFS los bytes.
- Las URLs prefirmadas usan S3_PUBLIC_ENDPOINT para que el navegador alcance el gateway publicado.
- Ver decisión vigente en docs/decisions/ADR-004-almacenamiento-seaweedfs.md. Los volúmenes antiguos de MinIO no son compatibles ni se copian automáticamente.

## 2026-11-06 — SPEC-802: administrar destinos (T1 a T3)

- Se implementó SPEC-802 en `feat/802-administrar-destinos`: migración de `files.destination.name` y `location`, CRUD de destinos propios (`/destinations`), validación del endpoint contra loopback, link-local, metadatos y, con `DESTINATION_ALLOW_PRIVATE`, rangos privados, y prueba de conexión `POST /destinations/:id/test`.
- Cambio de interfaz: `StorageRouter` ahora entrega clientes S3 propios por destino (cacheados e invalidados al editar) y expone `probe`. Los destinos de entorno siguen usando `StorageService`.
- Contrato: `CONTRACTS.md` v0.6 agrega las rutas, los códigos `DESTINATION_IN_USE` y `DESTINATION_ENDPOINT_NOT_ALLOWED`, los eventos `DESTINATION_*` y el tipo de recurso `destination`.
- `ADR-006` §2.5 cambia: los destinos propios guardan credenciales cifradas con la llave maestra. La rotación de SPEC-005 debe re-cifrarlas.
- Pendiente: T4, prueba manual con dos contenedores S3 (escenarios 3 y 10). La spec sigue en estado Aprobada hasta cerrarla.

## 2026-11-09 — SPEC-807: conexión a PostgreSQL con SSL y puerto de la plataforma

- Implementado en `feat/807-conexion-postgres-ssl` (desde `main` `8561e5e`): `buildPostgresSsl` (`apps/api/src/config/postgres-config.ts`) y `resolveApiPort` (`apps/api/src/config/api-port.ts`), con sus pruebas. Cableado en `app.module.ts` (`ssl`) y `main.ts` (puerto). `.env.example` con `POSTGRES_SSL` y `POSTGRES_SSL_CA`. Guía y catálogo actualizados.
- Decisión D1 confirmada: un valor vacío de `POSTGRES_SSL`, `POSTGRES_SSL_CA`, `API_PORT` o `PORT` cuenta como no definido.
- Verificación automática en `apps/api`: `npm run lint` sin errores (61 avisos), `tsc`, `build` y `npm test` (58 suites, 936 pruebas en verde tras fusionar `main` d9c5d1c; 25 nuevas de SPEC-807).
- Verificación manual, build local:
  - Escenario 6: `PORT=10000` sin `API_PORT` escucha en 10000 y `/api/health` responde 200.
  - Escenarios 4, 5 y 9: el proceso termina con código 1 y el mensaje exacto, sin filtrar secretos.
  - Cableado de SSL: con `POSTGRES_SSL=true` contra la base de desarrollo (sin SSL), PostgreSQL responde "The server does not support SSL connections". Eso confirma que la conexión pide TLS.
  - Regresión local sin SSL (`.env.example`): escucha en 3001 y `/api/health` reporta PostgreSQL `up`.
- Pendiente (requiere la URL externa de Render, que no está disponible en esta sesión):
  - Pre-vuelo TLS: comprobar con `openssl s_client -starttls postgres` que el certificado de Render valida con las autoridades del sistema. Si no valida, usar `POSTGRES_SSL_CA` con ruta absoluta.
  - Escenario 10: `npm run seed:super-admin` contra la base externa de Render con `POSTGRES_SSL=true`. No ejecutado.
- Pendiente de decisión: PR a `main` y paso de la fila de `specs/README.md` a ✅ Hecho tras el merge.
