# Bitácora de coordinación

> Las entradas previas a 2026-10-08 documentan el proveedor histórico MinIO; ADR-004 establece SeaweedFS como configuración local vigente.


Registro dinámico de decisiones, acuerdos pendientes y bloqueos. Añada entradas nuevas al principio; no borre historia. Las propuestas se marcan como pendientes hasta que el equipo las acepte.

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
