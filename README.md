# Nexus — almacenamiento seguro híbrido

Repositorio inicial para el proyecto de Ingeniería de Software I. Nexus es una plataforma para que organizaciones administren archivos y controlen dónde se almacenan: nube, infraestructura propia o un modelo híbrido.

> **Estado:** prototipo frontend navegable. Los formularios, contratación y operaciones de archivos son simulaciones locales; no hay autenticación, pagos, base de datos ni carga real de binarios conectados.

## Antes de empezar

1. Lean `SYSTEM_PROMPT.md`, `ARCHITECTURE.md`, `BUSINESS_RULES.md` y `CONTRIBUTING.md`.
2. Revisen `ENTS_REGISTRY.md`, `CONTRACTS.md` y `docs/FIGMA_MAP.md` para saber quién es dueño de cada parte.
3. Consulten `docs/IDENTIDAD_VISUAL.md` para la paleta acordada y la tipografía Inter.
4. Comparen cada ruta de la web con Figma. No inventen campos ni estados que cambien el diseño aprobado.
5. Acuerden los contratos y la decisión de despliegue de 30% en el equipo antes de que agentes implementen módulos en paralelo.

## Stack base

- Web: Next.js App Router + TypeScript.
- API prevista: NestJS + TypeScript.
- Datos: PostgreSQL 16.
- Objetos: MinIO compatible con S3.
- Ejecución local prevista: Docker Compose.

La propuesta final conserva la separación de dominios, el patrón Strategy para proveedores de almacenamiento y la meta de despliegue híbrido. Para el primer recorrido se mantiene el código modular y se evita distribuir servicios antes de que el equipo confirme que puede operarlos. Ver `docs/decisions/ADR-001-despliegue-del-corte-30.md`.

## Requisitos locales

- Node.js 22 LTS o una versión LTS posterior compatible con Next.js.
- npm 10 o posterior.
- Docker Desktop o Docker Engine con Compose.

## Arrancar la base web

```bash
npm install
npm run dev:web
```

Abra `http://localhost:3000`. La web incluye estas rutas:

- Sitio público: `/`, `/servicios`, `/planes` y `/contacto`.
- Planes y suscripción: `/planes/[planId]`, `/suscripcion`, `/suscripcion/confirmar`, `/suscripcion/exito`, `/suscripcion/fallida`, `/suscripcion/cambiar-plan`, `/suscripcion/cambio-rechazado` y `/suscripcion/vencida`.
- Acceso: `/registro`, `/registro/completado`, `/verificar-correo`, `/login`, `/recuperar-contrasena`, `/nueva-contrasena` y `/sesion-vencida`.
- Espacio de trabajo: `/dashboard`, `/dashboard/vacio`, `/dashboard/cuota-excedida`, `/dashboard/super-admin`, `/archivos`, `/archivos/[folderId]`, `/archivos/cuota-excedida`, `/papelera`, `/configuracion` y `/auditoria`.

El sitio público y sus formularios son frontend de demostración: no envían solicitudes ni llaman a la API. El recorrido de identidad muestra estados de registro, verificación, inicio de sesión y recuperación sin guardar contraseñas. La contratación y suscripción usan valores de referencia en almacenamiento local; no procesan pagos y esperan el catálogo real de Billing. El dashboard y el explorador usan datos locales de muestra. La administración de archivos permite probar creación de carpetas, validaciones, carga simulada, duplicados/versiones, detalle, descarga demostrativa y papelera; no transfiere ni almacena los binarios en MinIO/S3. Las versiones y la descarga de demostración contienen solo metadatos simulados. `/configuracion` y `/auditoria` siguen como estructuras iniciales. Ninguna pantalla se declara cotejada con Figma hasta revisar sus frames; consulta `docs/FIGMA_MAP.md`.

## Servicios locales

```bash
cp .env.example .env
docker compose up -d
```

PostgreSQL se publica en `localhost:5432`; MinIO en `localhost:9000` y su consola en `localhost:9001`. Las credenciales de `.env.example` son solo para desarrollo local; nunca reutilizarlas fuera de la máquina de desarrollo.

## Comandos útiles

```bash
npm run dev:web
npm run build:web
npm run lint:web
npm run infra:up
npm run infra:down
```

## Directorios

```text
apps/
  web/                 Next.js: rutas, componentes y estilos compartidos
  api/                 espacio reservado para la API NestJS y sus módulos
    src/modules/       IAM, Billing, Files, Storage y Health
    src/shared/        identidad, errores y utilidades compartidas aprobadas
    src/               README de arranque; se completa en el trabajo de API
    README.md
docs/
  decisions/            decisiones arquitectónicas con fecha y estado
  IDENTIDAD_VISUAL.md   colores, tipografía y reglas para pantallas
.github/                plantillas para PR e incidencias
```

## Fuentes funcionales

- `Propuesta PaaS Almacenamiento Seguro Hibrido.pdf`: producto aprobado, alcance, requisitos, stack y modelo híbrido.
- `Proyecto de Ingeniería de Software 2603.pdf`: requerimientos del curso, incluyendo usuarios y contratación simulada.
- `diccionario_datos(1).pdf`: vocabulario y restricciones de las entidades de datos.

El detalle operativo para el equipo está resumido en los documentos de este repositorio. Si una implementación contradice una fuente, documenten la diferencia en `SESSION_LOG.md` y acuerden el cambio antes de programarlo.
