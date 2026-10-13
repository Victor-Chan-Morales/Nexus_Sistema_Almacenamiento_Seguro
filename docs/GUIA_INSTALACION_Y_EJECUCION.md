# Guía de instalación y ejecución local

Esta guía permite que cada integrante prepare su computadora y ejecute Nexus con la arquitectura de monolito modular y SeaweedFS. La configuración descrita es para desarrollo local.

## 1. Requisitos en cada computadora

Instalar lo siguiente antes de clonar o ejecutar el proyecto:

| Dependencia | Requisito | Para qué se usa |
| --- | --- | --- |
| Windows 10/11, macOS o Linux | Sistema de 64 bits | Sistema operativo de desarrollo |
| Git | Versión reciente | Clonar el repositorio y trabajar con ramas |
| Node.js | 22 LTS o posterior compatible; el proyecto declara `>=22 <27` | Ejecutar API y frontend |
| npm | 10 o posterior | Instalar dependencias y ejecutar scripts |
| Docker Desktop o Docker Engine | Con Docker Compose v2 | Ejecutar PostgreSQL y SeaweedFS |
| Editor | VS Code recomendado, opcional | Editar el proyecto |
| Cliente HTTP | Postman, Insomnia o extensión REST de VS Code; opcional | Probar la API manualmente |

En Windows, Docker Desktop debe estar iniciado y tener habilitado el backend WSL 2. No hace falta instalar PostgreSQL ni SeaweedFS directamente en la computadora: Compose descarga y ejecuta sus contenedores.

### Comprobar las herramientas

En PowerShell, ejecutar:

```powershell
git --version
node --version
npm --version
docker --version
docker compose version
```

Node debe ser 22 o superior, menor que 27; npm debe ser 10 o superior. Si `docker compose version` falla, instalar o actualizar Docker Desktop y abrirlo antes de continuar.

## 2. Descargar el proyecto e instalar paquetes

Clonar la rama que el equipo haya acordado como base. Ejemplo:

```powershell
git clone https://github.com/Victor-Chan-Morales/Nexus_Sistema_Almacenamiento_Seguro.git
Set-Location Nexus_Sistema_Almacenamiento_Seguro
```

Si el equipo está trabajando en otra rama, cambiar a ella antes de instalar:

```powershell
git switch nombre-de-la-rama
git pull
```

Instalar dependencias del frontend y luego las de la API:

```powershell
npm install
npm run install:api
```

Ejecutar estos comandos desde la carpeta raíz del repositorio. No instalar paquetes globales de NestJS, Next.js, PostgreSQL ni SeaweedFS para correr la aplicación.

## 3. Configurar variables locales

Crear `.env` desde la plantilla de ejemplo:

```powershell
Copy-Item .env.example .env
```

Editar `.env` solo si se necesita cambiar puertos o credenciales locales. Para API y frontend ejecutados directamente en Windows, la plantilla usa estos servicios/valores:

- PostgreSQL: `localhost:5433`
- API S3 de SeaweedFS: `localhost:8333`
- API Nexus: `http://localhost:3001`
- Frontend: `http://localhost:3000`
- Bucket de desarrollo: `nexus-dev`

No subir `.env` a Git ni compartir sus secretos. `.env.example` contiene valores de desarrollo y no debe reutilizarse en producción.

## 4. Iniciar PostgreSQL y SeaweedFS

Desde la raíz del proyecto:

```powershell
npm run infra:up
docker compose ps
```

El script `infra:up` inicia PostgreSQL y SeaweedFS en segundo plano. La API S3 de SeaweedFS se publica en el puerto `8333`; PostgreSQL se publica en `5433` en la computadora y escucha en `5432` dentro de Docker.

Para revisar los registros:

```powershell
npm run infra:logs
```

También se pueden consultar por servicio:

```powershell
docker compose logs -f postgres
docker compose logs -f seaweedfs
```

La primera descarga de imágenes puede tardar según la conexión. Esperar a que PostgreSQL indique que acepta conexiones antes de iniciar la API.

## 5. Iniciar API y frontend en modo desarrollo

Usar **tres terminales de PowerShell**, todas ubicadas en la raíz del repositorio.

Terminal 1 — API NestJS:

```powershell
npm run dev:api
```

La API local debe conectarse a PostgreSQL y SeaweedFS por `localhost`, usando los puertos publicados en `.env`.

Terminal 2 — frontend Next.js:

```powershell
npm run dev:web
```

Abrir `http://localhost:3000` en el navegador. La API está disponible en `http://localhost:3001/api` y su comprobación de salud en:

```text
http://localhost:3001/api/health
```

Terminal 3 — opcional, para observar servicios:

```powershell
docker compose ps
npm run infra:logs
```

Para detener API o frontend, presionar `Ctrl+C` en la terminal correspondiente. Para detener PostgreSQL y SeaweedFS sin borrar los datos:

```powershell
npm run infra:down
```

## 6. Opción: ejecutar también la API en Docker

Como alternativa al desarrollo local de la API, Compose ofrece un perfil opcional:

```powershell
docker compose --profile containerized-api up -d --build
docker compose ps
```

En ese perfil, la API se conecta a los servicios dentro de la red Docker usando los nombres `postgres` y `seaweedfs`, con sus puertos internos. No iniciar simultáneamente `npm run dev:api` si ambos procesos intentan usar el puerto `3001`.

Para revisar la API en Docker:

```powershell
docker compose logs -f api
Invoke-RestMethod http://localhost:3001/api/health
```

Para volver al modo de API local, detener el perfil de Compose y arrancar `npm run dev:api`.

## 7. Base de datos y datos de desarrollo

PostgreSQL se ejecuta dentro del contenedor `postgres`. En la configuración actual, TypeORM carga las entidades y sincroniza el esquema automáticamente cuando `NODE_ENV` no es `production`. Por eso, para desarrollo local no se debe ejecutar un comando manual de migración a menos que el proyecto incorpore y documente un flujo de migraciones vigente.

La base y sus tablas se mantienen en el volumen `nexus-postgres-data`; los objetos de SeaweedFS se mantienen en `nexus-seaweedfs-data`. Detener Compose con `npm run infra:down` conserva ambos volúmenes.

**No ejecutar `docker compose down -v` para apagar el proyecto:** `-v` elimina los volúmenes y borra la base y los objetos locales. Usarlo solo cuando el equipo decida explícitamente reiniciar todos los datos de desarrollo.

La sincronización automática del esquema es una comodidad exclusiva del desarrollo; no equivale a migraciones versionadas y no debe activarse en producción.

## 8. Puertos usados

| Servicio | Dirección desde la computadora | Puerto dentro de Docker |
| --- | --- | --- |
| Frontend Next.js | `http://localhost:3000` | No se ejecuta en Compose por defecto |
| API NestJS | `http://localhost:3001/api` | `3001` si se usa el perfil de API |
| PostgreSQL | `localhost:5433` | `5432` |
| SeaweedFS S3 | `localhost:8333` | `8333` |
| SeaweedFS Master | `localhost:9333` | `9333` |
| SeaweedFS Filer | `localhost:8888` | `8888` |

Si un puerto ya está ocupado, cerrar el proceso que lo usa o coordinar un cambio de puerto en Compose y `.env`. Si se cambia un puerto, todos los integrantes deben actualizar la misma configuración documentada.

## 9. Problemas frecuentes

### Docker no responde

Abrir Docker Desktop, esperar a que indique que está funcionando y volver a ejecutar `docker compose ps`. En Windows, revisar que WSL 2 y la virtualización estén habilitados.

### La API no conecta a PostgreSQL

- En desarrollo local, revisar `POSTGRES_HOST=127.0.0.1` y `POSTGRES_PORT=5433` en `.env`.
- Si la API corre dentro de Compose, usar el host `postgres` y puerto interno `5432` (el perfil de Compose los configura).
- Revisar `docker compose logs postgres` y que el contenedor esté iniciado.

### La API no conecta a SeaweedFS

- Para API local, usar `S3_ENDPOINT=localhost`, `S3_PORT=8333` y `S3_USE_SSL=false`.
- Para API dentro de Compose, el endpoint debe ser `seaweedfs` y el puerto interno `8333` (el perfil lo configura).
- Revisar `docker compose logs seaweedfs` y que el contenedor esté iniciado.

### Puerto ocupado

Revisar la tabla de puertos. No cambiar solo el `.env`: también se debe revisar el mapeo de puertos en `docker-compose.yml` y mantener coherencia entre API, frontend y servicios.

### Dependencias de Node dañadas o desactualizadas

Actualizar la rama acordada y volver a ejecutar `npm install` y `npm run install:api` desde la raíz. No borrar volúmenes de Docker como método para corregir paquetes de Node.

## 10. Flujo recomendado para cada integrante

1. Actualizar la rama base acordada por el equipo.
2. Instalar Node.js/npm y Docker Compose una sola vez.
3. Ejecutar `npm install` y `npm run install:api` después de clonar o actualizar archivos de dependencias.
4. Crear `.env` local desde `.env.example`.
5. Iniciar infraestructura con `npm run infra:up`.
6. Ejecutar API y frontend, y comprobar `/api/health`.
7. Trabajar en su rama y no modificar los `.env` locales de los demás.
8. Antes de entregar, registrar los comandos y escenarios realmente ejecutados.
