# Nexus — almacenamiento seguro híbrido

Repositorio inicial para el proyecto de Ingeniería de Software I. Nexus es una plataforma para que organizaciones administren archivos y controlen dónde se almacenan: nube, infraestructura propia o un modelo híbrido.

> **Estado:** estructura base para el avance funcional. Las pantallas web son esqueletos navegables y deben cotejarse con los mockups reales de Figma antes de presentarlas. No hay operaciones de autenticación, pagos, base de datos ni carga de archivos implementadas todavía.

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

Abra `http://localhost:3000`. Las rutas base son `/login`, `/registro`, `/planes`, `/dashboard` y `/archivos`. Por ahora muestran estructura y textos de preparación, no funcionalidad real.

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
