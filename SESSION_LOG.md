# Bitácora de coordinación

Registro dinámico de decisiones, acuerdos pendientes y bloqueos. Añada entradas nuevas al principio; no borre historia. Las propuestas se marcan como pendientes hasta que el equipo las acepte.

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
