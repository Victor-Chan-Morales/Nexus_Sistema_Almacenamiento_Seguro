# Bitácora de coordinación

Registro dinámico de decisiones, acuerdos pendientes y bloqueos. Añada entradas nuevas al principio; no borre historia. Las propuestas se marcan como pendientes hasta que el equipo las acepte.

## 2026-09-28 — revisión del diagrama de clases

- **Estado:** el SVG nuevo fue comparado con DiagramaClases.svg; su aprobación como modelo de implementación queda pendiente.
- **Cambio observado:** pasa de 29 a 33 clases; agrega AuthService, BillingService, InstallationService y DatabaseServiceClient. No se detectaron cambios en atributos de clases existentes; sí se trasladaron métodos y cambiaron/eliminaron asociaciones.
- **Decisiones de documentación:** se mantienen las fronteras IAM (Sebastián), Billing (Anthony), Files/Storage (Miguel) e integración/frontend (Víctor). InstallationService queda sin dueño hasta acuerdo. DatabaseServiceClient no se acepta como servicio de aplicación transversal; repositorios/puertos permanecen por dominio.
- **Pendientes bloqueantes:** restaurar/definir asociaciones Usuario–Membresía/Sesión, tenant–instalación, carpeta/versión–destino, versión–llave, usuario/equipo–permisos; agregar campos persistentes faltantes de FILE_VERSION y AUDIT_EVENT.
- **Pendiente Billing:** alinear storage_limit_gb del diccionario con storageLimitBytes del contrato y resolver userLimit, description y validityDays antes de migrar. No inventar columnas ni cambiar unidades en frontend.
- **Alcance:** MFA, recuperación, instalación, cifrado completo, enlaces y auditoría avanzada siguen en el producto final, no se consideran parte automática del siguiente hito.
- **Referencia:** `docs/revision-diagrama-clases.md` contiene comparación y criterio de cierre.

## 2026-09-29 — identidad visual compartida

- **Estado:** propuesta implementada en rama para revisión mediante PR.
- **Fuente:** paleta y tipografía Inter comunicadas por Víctor para las pantallas del proyecto.
- **Cambios:** se añadió `docs/IDENTIDAD_VISUAL.md`; se documentó su uso en README, instrucciones globales, arquitectura, contribución, registro de módulos y mapa Figma; `globals.css` define tokens para todos los colores indicados y usa Inter como familia de fuente.
- **Alcance visual:** no se modificó la geometría ni se afirma que los frames Figma estén verificados. Los usos semánticos sugeridos deben compararse con el mockup original.
- **Pendiente:** Víctor/equipo coteja los tokens, pesos tipográficos y gradiente en cada frame y actualiza `docs/FIGMA_MAP.md` al compartir la referencia Figma.

## 2026-09-28 — preparación inicial del repositorio

- **Estado:** scaffold inicial publicado; acuerdos del producto y contratos aún requieren revisión del equipo.
- **Alcance:** estructura monorepo, rutas Next.js base, documentación de agentes, reglas de negocio y contratos propuestos para el flujo de 30%.
- **Dueño frontend:** Víctor implementará el frontend común y las pantallas de todos los módulos, siguiendo la indicación más reciente del usuario. Sebastián, Miguel y Anthony implementan sus dominios de API y entregan a Víctor contratos, campos, estados y errores.
- **Figma:** los frames no están adjuntos al repositorio. Las rutas web son estructura de trabajo, no una transcripción aprobada de las pantallas. Pendiente completar ID/frame, campos, estados y capturas en `docs/FIGMA_MAP.md`.
- **Stack:** los PDFs indican Next.js, NestJS, PostgreSQL 16, Redis Streams, MinIO/S3, libsodium y Docker Compose. Este scaffold inicializa la web; la API y otros módulos siguen pendientes de implementación. No se cambian requisitos del producto final.
- **Decisiones pendientes:** aprobar contratos v0.1; confirmar manejo de verificación de correo en demo; validar ADR de despliegue para 30%; revisar la matriz de roles frente al diccionario de datos; acordar límites de carga y plan semilla.
- **Bloqueo externo:** el conector GitHub disponible no ofrece una acción para crear repositorios. El repositorio se publicó después de esa nota.

### Plantilla para la próxima reunión

- Fecha / participantes:
- Decisiones aprobadas (incluya ID de ADR o versión de contrato):
- Dudas y dueño de resolverlas:
- Cambios de asignación:
- Próximas acciones y fecha:
