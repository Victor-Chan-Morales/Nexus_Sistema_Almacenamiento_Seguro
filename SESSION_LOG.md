# Bitácora de coordinación

> Las entradas previas a 2026-10-08 documentan el proveedor histórico MinIO; ADR-004 establece SeaweedFS como configuración local vigente.


Registro dinámico de decisiones, acuerdos pendientes y bloqueos. Añada entradas nuevas al principio; no borre historia. Los contratos de integración v0.3 fueron aprobados por el integrador para implementación el 2026-10-18.

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
