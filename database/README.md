---

editor_options: 
  markdown: 
    wrap: 72
---

# Base de datos

## Estructura

```         
database/
├── migrations/     Migraciones
├── seeds/          Datos de desarrollo
└── README.md       Este archivo
```

## Herramienta de migraciones: dbmate

## Arquitectura: esquemas y Servicio de Base de Datos unificado

Cinco esquemas de Postgres (`admin`, `iam`, `files`, `billing`, `audit`) organizan las 29 tablas por dominio — decisión evaluada, no automática: con **un solo servicio** (el `database-service`) accediendo a toda la base, los esquemas ya no son un límite de seguridad (eso se abandonó en la revisión v3 del MER), pero siguen siendo la forma más clara de navegar 29 tablas relacionadas, y permiten que todas las FK entre dominios sean llaves foráneas **reales** (no hay necesidad de esquemas separados por cuenta).

Ningún otro microservicio (iam, files, billing, audit, admin) tiene credenciales de PostgreSQL. Le hablan al `database-service` por HTTP usando `DATABASE_SERVICE_URL` (ver `.env.example` y `services/_shared/database-client/README.md`).

## Comandos

Todos asumen que existe un `.env` en la raíz del proyecto.

### Arrancar PostgreSQL

``` bash
docker compose up -d postgres
```

### Ver el estado

``` bash
docker compose ps
docker compose exec postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

### Crear una base en el primer arranque

``` bash
docker compose up -d postgres         # espera a que el healthcheck pase
docker compose run --rm migrate up    # aplica las 14 migraciones, en orden
```

### Ejecutar migraciones (entorno ya existente, hay migraciones nuevas)

``` bash
docker compose run --rm migrate up
```

Es idempotente — si no hay migraciones pendientes, no hace nada.

### Reiniciar la base de desarrollo (borra todo)

``` bash
docker compose down -v      # -v elimina también el volumen postgres_data
docker compose up -d postgres
docker compose run --rm migrate up
```

### Ejecutar seeds (datos de desarrollo)

``` bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < database/seeds/001_dev_seed.sql
```

### Conectarse con psql (desde el host)

``` bash
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

O directamente desde el host (usa el puerto mapeado, no 5432 del contenedor — revisa `POSTGRES_PORT` en tu `.env`):

``` bash
psql "postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:${POSTGRES_PORT:-5432}/$POSTGRES_DB"
```

### Crear una migración nueva

``` bash
docker compose run --rm migrate new nombre_de_la_migracion
```

Crea `database/migrations/<timestamp>_nombre_de_la_migracion.sql` con los bloques `-- migrate:up` / `-- migrate:down` vacíos, listos para editar.

### Otros comandos útiles de dbmate(gestor de migraciones)

``` bash
docker compose run --rm migrate status     # qué migraciones están aplicadas / pendientes
docker compose run --rm migrate rollback   # revierte la ÚLTIMA migración aplicada
```

### Conectar un microservicio

Dentro de Docker, el hostname de PostgreSQL es el **nombre del servicio de Compose**:

```         
postgres
```

Pero en este proyecto casi ningún microservicio debería conectarse a `postgres` directamente: **solo `database-service` lo hace.** El resto usa:

```         
DATABASE_SERVICE_URL=http://database-service:3000
```

(Necesaria implementaicon de servicio de db)
