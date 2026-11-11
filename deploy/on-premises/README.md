# Instalación on-premises de Nexus

El paquete publica la web y la API por HTTP. PostgreSQL, SeaweedFS y el proceso de migración se conectan dentro de la red de Docker. Usa este modo en el servidor o en una red privada de pruebas.

## Requisitos

- Linux con Docker Engine activo, contenedores Linux y acceso al motor.
- Docker Compose v2.20 o posterior. Compose v5 también es compatible. [Versiones de Docker Compose](https://docs.docker.com/compose/intro/history/)
- Bash, OpenSSL, jq, iproute2, util-linux y las utilidades básicas de Linux. Para la prueba de humo también se necesita curl.
- Al menos 5 GiB libres para imágenes y arranque. Reserva espacio adicional para archivos y respaldos.
- Acceso a los registros de imágenes y a npm durante la construcción. El instalador usa el almacén de autoridades CA del servidor para verificar TLS durante el build. Si la red usa un proxy de inspección TLS, instala su autoridad en Docker y en el servidor o indica el archivo PEM con `NEXUS_BUILD_CA_FILE`.
- Dos puertos libres. Por defecto son 3000 para la web y 3001 para la API.

## Instalar

Desde la raíz del repositorio:

```bash
./deploy/on-premises/install.sh
```

Abre `http://localhost:3000/servicios`. El estado de la API se consulta en `http://localhost:3001/api/health`. La primera ejecución genera `deploy/on-premises/.env` con permisos `600`. Guarda ese archivo como secreto. Las siguientes ejecuciones conservan la configuración y los volúmenes y aplican las migraciones pendientes.

Para elegir un nombre DNS o IPv4 y otros puertos en la primera ejecución, pasa las variables siguientes. Usa una dirección de enlace del servidor. El valor `0.0.0.0` habilita todas las interfaces IPv4.

```bash
NEXUS_PUBLIC_HOST=nexus.intranet NEXUS_BIND_ADDRESS=192.168.1.20 \
NEXUS_WEB_PORT=8080 NEXUS_API_PORT=8081 ./deploy/on-premises/install.sh
```

Después de instalar, edita los valores persistidos en `.env` y vuelve a ejecutar el instalador. Así se reconstruye la web con el origen público de la API y se actualizan el origen permitido por CORS y los enlaces de correo. Usa el mismo nombre de host para acceder a la web y a la API. Si alojas varias instalaciones, asigna un `NEXUS_PROJECT_NAME` distinto a cada una al instalarlas.

## Correo y prueba de humo

Sin SMTP, la configuración inicial permite iniciar sesión sin verificar el correo. Úsala para pruebas locales. Para comprobar que quien se registra controla su buzón, configura `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_FROM` y las credenciales SMTP que solicite el proveedor. Define `IAM_REQUIRE_VERIFIED_EMAIL=true` y ejecuta de nuevo `install.sh`. Conserva los permisos del archivo y usa la sintaxis de Compose para valores con caracteres especiales.

El instalador usa `NEXUS_API_NODE_ENV=development` para el arranque local sin SMTP. En un despliegue de producción, define `NEXUS_API_NODE_ENV=production` e `IAM_REQUIRE_VERIFIED_EMAIL=true` y configura Gmail API antes de arrancar. Consulta [la configuración de Gmail por HTTPS](../../docs/GUIA_INSTALACION_Y_EJECUCION.md#correo-real-en-el-despliegue-spec-117).

```bash
./deploy/on-premises/smoke-test.sh
# Con SMTP, indica un correo o alias aún sin registrar y pega el enlace cuando se solicite.
NEXUS_SMOKE_EMAIL=operador+prueba@example.org ./deploy/on-premises/smoke-test.sh --verify
```

La prueba crea una organización y una cuenta de prueba, inicia sesión, sube un archivo sintético y compara la descarga byte a byte. Al exigir verificación, el script también solicita el enlace que llega al correo.

## Reinicio y respaldo

El motor Docker debe iniciar con Linux. Los cuatro servicios permanentes vuelven a arrancar con él y usan volúmenes persistentes. Para respaldarlos de forma coherente, desde `deploy/on-premises`:

```bash
umask 077
mkdir -p "$HOME/nexus-respaldo"
docker compose stop web api
docker compose exec -T postgres pg_dump -U nexus -Fc nexus > "$HOME/nexus-respaldo/postgres.dump"
docker compose stop seaweedfs
docker compose run --rm --no-deps -T --entrypoint tar seaweedfs -C /data -czf - . > "$HOME/nexus-respaldo/seaweedfs.tgz"
install -m 600 .env "$HOME/nexus-respaldo/nexus.env"
docker compose up -d --wait
```

Guarda las tres piezas juntas en un almacén de respaldos protegido y practica la restauración en volúmenes nuevos. Usa el `.env` respaldado antes de crear PostgreSQL, restaura la base con `pg_restore` y extrae el archivo de SeaweedFS en su volumen con el servicio detenido. Luego ejecuta `install.sh` para aplicar migraciones pendientes y valida una descarga.

Si pierdes `.env`, recupera el original desde el respaldo. La llave maestra permite leer los archivos y los datos de conexión. Para cambiarla, sigue el procedimiento versionado de [SPEC-005 y ADR-006](../../docs/decisions/ADR-006-cifrado-node-crypto-aes-256-gcm.md).
