# Nexus — almacenamiento seguro híbrido

Repositorio para el proyecto de Ingeniería de Software I. Nexus es una plataforma para que organizaciones administren archivos y controlen dónde se almacenan: nube, infraestructura propia o un modelo híbrido.

## Estado de la arquitectura

El backend está implementado y opera como un **Monolito Modular** en NestJS, con los dominios (IAM, Billing, Files, Storage y Health) funcionando en un único proceso mediante inyección de dependencias interna (in-process). El frontend (Next.js) corre como un proceso independiente que consume la API REST.

## Antes de empezar

1. Lean `SYSTEM_PROMPT.md`, `ARCHITECTURE.md`, `BUSINESS_RULES.md` y `CONTRIBUTING.md`.
2. Revisen `ENTS_REGISTRY.md`, `CONTRACTS.md` y `docs/FIGMA_MAP.md` para responsabilidades por dominio.
3. Consulten `docs/IDENTIDAD_VISUAL.md` para la paleta acordada y la tipografía Inter.
4. Consulten `docs/decisions/ADR-001-despliegue-del-corte-30.md` para los detalles de la decisión arquitectónica aprobada.

## Stack base

- **Web:** Next.js App Router + TypeScript (puerto 3000, proceso independiente).
- **API:** NestJS + TypeScript en arquitectura de **Monolito Modular** (puerto 3001).
- **Datos:** PostgreSQL 16 (contenedor Docker).
- **Objetos:** MinIO compatible con S3 (contenedor Docker).
- **Orquestación local:** Docker Compose.

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

## Servicios de infraestructura y API

```bash
cp .env.example .env
npm run infra:up
```

- PostgreSQL se publica en `localhost:5432`.
- MinIO en `localhost:9000` y su consola en `localhost:9001`.
- API NestJS se publica en `http://localhost:3001/api` con health check en `http://localhost:3001/api/health`.

Para ejecutar la API en desarrollo local con recarga en caliente:
```bash
npm run dev:api
```

## Comandos útiles

```bash
# Frontend
npm run dev:web       # Arrancar Next.js en desarrollo (localhost:3000)
npm run build:web     # Compilar Next.js
npm run lint:web      # Linter de Next.js

# Backend (API monolítica modular NestJS)
npm run install:api   # Instalar dependencias del API
npm run dev:api       # Arrancar NestJS en desarrollo con hot-reload (localhost:3001)
npm run build:api     # Compilar NestJS TypeScript a dist/
npm run start:api     # Arrancar NestJS compilado

# Infraestructura Docker
npm run infra:up      # Levantar contenedores (postgres, minio, api)
npm run infra:down    # Detener contenedores
npm run infra:logs    # Ver logs en vivo de Docker Compose
```

## Directorios

```text
apps/
  web/                 Next.js: rutas, componentes, cliente de API tipado y estilos compartidos
  api/                 API NestJS (monolito modular)
    src/modules/
      iam/             Autenticación, usuarios, organizaciones, membresías y JWT
      billing/         Planes, suscripciones y control de cuota
      files/           Carpetas, archivos, versiones y control de almacenamiento
      storage/         Proveedor MinIO/S3 (patrón Strategy)
      health/          Health check (/api/health) con @nestjs/terminus
    src/shared/        Decoradores, contexto de request y utilidades comunes
    src/main.ts        Punto de entrada de la API (puerto 3001, CORS, ValidationPipe)
    src/app.module.ts  Módulo raíz que integra todos los dominios in-process
    Dockerfile         Imagen de producción para el API
docs/
  decisions/            Decisiones arquitectónicas aprobadas (ADR-001, ADR-002, ADR-003)
  IDENTIDAD_VISUAL.md   Colores, tipografía y reglas para pantallas
.github/                Plantillas para PR e incidencias
```

## Fuentes funcionales

- `Propuesta PaaS Almacenamiento Seguro Hibrido.pdf`: producto aprobado, alcance, requisitos, stack y modelo híbrido.
- `Proyecto de Ingeniería de Software 2603.pdf`: requerimientos del curso, incluyendo usuarios y contratación simulada.
- `diccionario_datos(1).pdf`: vocabulario y restricciones de las entidades de datos.
