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
