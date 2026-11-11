#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

for tool in docker openssl jq ss ip flock df stat awk grep mktemp ln; do
  command -v "$tool" >/dev/null 2>&1 || fail "Falta $tool. Consulta deploy/on-premises/README.md."
done
[[ $(uname -s) == Linux ]] || fail 'La instalación requiere Linux.'

directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
env_file="$directory/.env"
exec {lock_fd}<"$directory"
flock -n "$lock_fd" || fail 'Ya hay otra instalación en este directorio.'

compose_version=$(docker compose version --short 2>/dev/null) || fail 'Instala el complemento Docker Compose v2.20 o posterior.'
[[ $compose_version =~ ^v?([0-9]+)\.([0-9]+)(\.|$) ]] || fail 'No se pudo verificar la versión de Docker Compose.'
major=${BASH_REMATCH[1]}
minor=${BASH_REMATCH[2]}
(( major > 2 || (major == 2 && minor >= 20) )) || fail 'Se requiere Docker Compose v2.20 o posterior.'
engine=$(docker info --format '{{.OSType}}' 2>/dev/null) || fail 'Docker no está iniciado o faltan permisos de acceso al motor.'
[[ $engine == linux ]] || fail 'Docker debe ejecutar contenedores Linux.'

check_space() {
  local available
  available=$(df -Pk -- "$1" | awk 'END { print $4 }')
  [[ $available =~ ^[0-9]+$ ]] || fail 'No se pudo comprobar el espacio libre.'
  (( available >= 5 * 1024 * 1024 )) || fail "Se necesitan al menos 5 GiB libres en $1."
}

check_space "$directory"
docker_root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null)
if [[ -d $docker_root ]]; then check_space "$docker_root"; fi

if [[ -z ${NEXUS_BUILD_CA_FILE:-} ]]; then
  for bundle in /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt /etc/ssl/cert.pem; do
    if [[ -r $bundle ]]; then NEXUS_BUILD_CA_FILE=$bundle; break; fi
  done
fi
[[ -r ${NEXUS_BUILD_CA_FILE:-} ]] || fail 'Instala las autoridades CA del sistema o define NEXUS_BUILD_CA_FILE con la ruta a un archivo PEM.'
export NEXUS_BUILD_CA_FILE

project_name=${NEXUS_PROJECT_NAME:-nexus-on-premises}
public_host=${NEXUS_PUBLIC_HOST:-localhost}
bind_address=${NEXUS_BIND_ADDRESS:-127.0.0.1}
web_port=${NEXUS_WEB_PORT:-3000}
api_port=${NEXUS_API_PORT:-3001}
# La configuración persistida tiene prioridad sobre las variables exportadas por otra instalación.
unset NEXUS_PUBLIC_HOST NEXUS_BIND_ADDRESS NEXUS_WEB_PORT NEXUS_API_PORT
unset COMPOSE_PROJECT_NAME COMPOSE_ENV_FILES COMPOSE_FILE COMPOSE_PROFILES
unset POSTGRES_PASSWORD S3_ACCESS_KEY S3_SECRET_KEY S3_FILER_SIGNING_KEY JWT_SECRET
unset FILES_MASTER_KEY FILES_MASTER_KEY_V2 FILES_MASTER_KEY_CURRENT_VERSION
unset NEXUS_API_NODE_ENV IAM_REQUIRE_VERIFIED_EMAIL MAIL_HOST MAIL_PORT MAIL_SECURE MAIL_REQUIRE_TLS MAIL_USER MAIL_PASS MAIL_FROM
unset MAIL_TRANSPORT GMAIL_SENDER GMAIL_CLIENT_ID GMAIL_CLIENT_SECRET GMAIL_REFRESH_TOKEN
compose=(docker compose --project-directory "$directory" --env-file "$env_file" -f "$directory/docker-compose.yml")

verify_email=false
mail_transport=smtp
mail_host=
if [[ -e $env_file || -L $env_file ]]; then
  [[ -f $env_file && ! -L $env_file ]] || fail 'El archivo .env debe ser un archivo regular.'
  [[ $(stat -c '%a' -- "$env_file") == 600 ]] || fail 'Protege .env con chmod 600 antes de continuar.'
  config=$("${compose[@]}" config --format json 2>/dev/null) || fail 'Revisa la configuración de .env y del paquete Compose.'
  project_name=$(jq -er '.name' <<<"$config")
  web_port=$(jq -er '.services.web.ports[0].published' <<<"$config")
  api_port=$(jq -er '.services.api.ports[0].published' <<<"$config")
  bind_address=$(jq -er '.services.web.ports[0].host_ip' <<<"$config")
  public_host=$(jq -er '.services.api.environment.WEB_URL | capture("^http://(?<host>[^:]+):[0-9]+$").host' <<<"$config") ||
    fail 'Configura NEXUS_PUBLIC_HOST como un nombre DNS o IPv4, sin protocolo ni puerto.'
  verify_email=$(jq -r '.services.api.environment.IAM_REQUIRE_VERIFIED_EMAIL' <<<"$config")
  mail_transport=$(jq -r '.services.api.environment.MAIL_TRANSPORT' <<<"$config")
  mail_host=$(jq -r '.services.api.environment.MAIL_HOST' <<<"$config")
  unset config
else
  [[ $project_name =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail 'NEXUS_PROJECT_NAME debe usar minúsculas, números, guiones o guiones bajos.'
  label="label=com.docker.compose.project=$project_name"
  volumes=$(docker volume ls --filter "$label" --quiet)
  containers=$(docker ps --all --filter "$label" --quiet)
  [[ -z $volumes && -z $containers ]] || fail 'Existen datos o contenedores del proyecto. Recupera su .env original antes de continuar.'
fi

[[ $public_host =~ ^[[:alnum:]]([[:alnum:].-]*[[:alnum:]])?$ ]] || fail 'Configura NEXUS_PUBLIC_HOST como un nombre DNS o IPv4, sin protocolo ni puerto.'
[[ $bind_address =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || fail 'NEXUS_BIND_ADDRESS debe ser una dirección IPv4 del servidor.'
if [[ $bind_address != 0.0.0.0 ]]; then
  interfaces=$(ip -4 -o address show)
  grep -Fq " $bind_address/" <<<"$interfaces" || fail "La dirección $bind_address no está configurada en el servidor."
fi
[[ $verify_email == true || $verify_email == false ]] || fail 'IAM_REQUIRE_VERIFIED_EMAIL debe ser true o false.'
[[ $verify_email == false || $mail_transport == gmail-api || -n $mail_host ]] ||
  fail 'Configura Gmail API o MAIL_HOST para exigir la verificación por correo.'

valid_port() { [[ $1 =~ ^[1-9][0-9]{0,4}$ ]] && (( $1 <= 65535 )); }
if ! valid_port "$web_port" || ! valid_port "$api_port"; then
  fail 'Los puertos deben estar entre 1 y 65535.'
fi
[[ $web_port != "$api_port" ]] || fail 'La web y la API deben usar puertos distintos.'

docker_ports=$(docker ps --format '{{.Ports}}')
check_port() {
  local service=$1 internal=$2 port=$3 mapped='' listening
  if [[ -f $env_file ]]; then
    mapped=$("${compose[@]}" port "$service" "$internal" 2>/dev/null || true)
  fi
  [[ $mapped == "$bind_address:$port" ]] && return 0
  listening=$(ss -H -ltn "sport = :$port")
  if [[ -n $listening ]] || grep -qE ":$port->" <<<"$docker_ports"; then
    fail "El puerto $port de $service está ocupado."
  fi
}
check_port web 3000 "$web_port"
check_port api 3001 "$api_port"

if [[ ! -f $env_file ]]; then
  [[ -r $directory/.env.template ]] || fail 'Falta la plantilla .env.template.'
  temp=$(mktemp "$directory/.env.XXXXXX")
  trap 'rm -f -- "$temp"' EXIT
  while IFS= read -r line || [[ -n $line ]]; do
    case "$line" in
      NEXUS_PUBLIC_HOST=*) value=$public_host ;;
      NEXUS_BIND_ADDRESS=*) value=$bind_address ;;
      NEXUS_WEB_PORT=*) value=$web_port ;;
      NEXUS_API_PORT=*) value=$api_port ;;
      COMPOSE_PROJECT_NAME=*) value=$project_name ;;
      S3_ACCESS_KEY=*) value=$(openssl rand -hex 12) || fail 'No se pudo generar el acceso a SeaweedFS.' ;;
      POSTGRES_PASSWORD=*|S3_SECRET_KEY=*|S3_FILER_SIGNING_KEY=*|JWT_SECRET=*)
        value=$(openssl rand -hex 32) || fail 'No se pudieron generar los secretos.' ;;
      FILES_MASTER_KEY=*) value=$(openssl rand -base64 32) || fail 'No se pudo generar la llave maestra.' ;;
      *) printf '%s\n' "$line"; continue ;;
    esac
    printf '%s=%s\n' "${line%%=*}" "$value"
  done <"$directory/.env.template" >"$temp"
  ln -- "$temp" "$env_file" || fail 'No se pudo crear .env sin sobrescribir un archivo existente.'
  unset value
  printf 'Configuración creada con permisos 600.\n'
fi

if [[ -z $mail_host ]]; then
  printf 'SMTP sin configurar. La verificación de correo está desactivada para uso local.\n'
elif [[ $verify_email == true ]]; then
  printf 'SMTP configurado y verificación de correo requerida.\n'
else
  printf 'SMTP configurado y verificación de correo opcional.\n'
fi

"${compose[@]}" build api web migrate
"${compose[@]}" up -d --wait --wait-timeout 150 postgres seaweedfs
"${compose[@]}" up -d --no-deps --force-recreate migrate
"${compose[@]}" up -d --wait --wait-timeout 180 api web
"${compose[@]}" ps postgres seaweedfs api web
printf 'Web: http://%s:%s/servicios\nAPI: http://%s:%s/api/health\n' "$public_host" "$web_port" "$public_host" "$api_port"
