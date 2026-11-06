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

## Arquitectura: esquemas en un monolito modular

Cinco esquemas de Postgres (`admin`, `iam`, `files`, `billing`, `audit`) organizan las tablas por dominio. Como un solo proceso, la API NestJS, accede a toda la base (ADR-008 §1), los esquemas no son un límite de seguridad. Se conservan porque facilitan navegar las tablas relacionadas y permiten que todas las FK entre dominios sean llaves foráneas **reales**.

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
docker compose run --rm migrate up    # aplica las migraciones pendientes, en orden
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

Este seed solo carga datos de referencia: sus usuarios **no pueden iniciar sesión** porque su `password_hash` es texto de relleno.

### Cuentas demo para iniciar sesión

Con la infraestructura levantada y las migraciones aplicadas, defina `DEMO_PASSWORD` en `.env` y ejecute:

``` bash
npm run seed:demo
```

Crea `admin@demo.test` (`tenant_admin`) y `colaborador@demo.test` (`colaborador`) en una misma organización, con los casos de uso de la API: suscripción, cuota, Drive y llave de cifrado son reales. Puede repetirse: no duplica cuentas y deja vigente la `DEMO_PASSWORD` actual. Se niega a correr con `NODE_ENV=production` o si `POSTGRES_HOST` no es local. El alta también genera sus correos de verificación e invitación; llegan a Mailpit y se pueden ignorar.

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

### Política: las migraciones avanzan, no se revierten

- Se aplican hacia adelante (`migrate:up`). Para corregir algo ya aplicado, se escribe una migración nueva.
- El `migrate:down` nunca debe borrar datos. Si la restauración no es posible porque hay filas que la impiden, debe fallar en lugar de descartarlas. Ejemplo: `20261027090000_allow_password_reset_outbox_kinds.sql`.
- `rollback` solo se usa en desarrollo, sobre una base sin datos reales.

### Conectar la API

La API se conecta directamente con las variables `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB`. Dentro de Docker, el host es el **nombre del servicio de Compose**:

```         
POSTGRES_HOST=postgres
```
