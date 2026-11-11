#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
[[ $# == 0 || ( $# == 1 && ${1:-} == --verify ) ]] || fail 'Uso: smoke-test.sh [--verify]'
for tool in docker curl jq openssl cmp mktemp; do
  command -v "$tool" >/dev/null 2>&1 || fail "Falta $tool."
done

directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
[[ -f $directory/.env ]] || fail 'Ejecuta install.sh primero.'
compose=(docker compose --project-directory "$directory" --env-file "$directory/.env" -f "$directory/docker-compose.yml")
unset NEXUS_PUBLIC_HOST NEXUS_WEB_PORT NEXUS_API_PORT NEXUS_BIND_ADDRESS
unset COMPOSE_PROJECT_NAME COMPOSE_ENV_FILES COMPOSE_FILE COMPOSE_PROFILES
unset IAM_REQUIRE_VERIFIED_EMAIL MAIL_HOST MAIL_TRANSPORT
config=$("${compose[@]}" config --format json 2>/dev/null) || fail 'Revisa la configuración de la instalación.'
web=$(jq -er '.services.api.environment.WEB_URL' <<<"$config")
api=$(jq -er '.services.web.build.args.NEXT_PUBLIC_API_BASE_URL' <<<"$config")
verify=$(jq -r '.services.api.environment.IAM_REQUIRE_VERIFIED_EMAIL' <<<"$config")
smtp=$(jq -r '.services.api.environment.MAIL_HOST | length' <<<"$config")
mail_transport=$(jq -r '.services.api.environment.MAIL_TRANSPORT' <<<"$config")
unset config
if [[ ${1:-} == --verify ]]; then verify=true; fi
[[ $verify == false || $mail_transport == gmail-api || $smtp != 0 ]] ||
  fail 'Configura Gmail API o SMTP para comprobar la verificación de correo.'
email=${NEXUS_SMOKE_EMAIL:-}
if [[ $verify == true && -z $email ]]; then
  fail 'Define NEXUS_SMOKE_EMAIL con un correo de prueba que pueda recibir el enlace.'
fi
if [[ -n $email ]]; then
  [[ $email =~ ^[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}$ ]] || fail 'NEXUS_SMOKE_EMAIL no es un correo válido.'
fi

temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
http=(curl --silent --show-error --fail --max-time 30)
json=(-H 'Content-Type: application/json' --data-binary @-)

"${http[@]}" "$web/servicios" -o /dev/null || fail 'La web no respondió.'
"${http[@]}" "$api/health" | jq -e '.status == "ok"' >/dev/null || fail 'La API no está sana.'
for service in postgres seaweedfs; do
  container=$("${compose[@]}" ps -q "$service")
  [[ -n $container ]] || fail "$service no está en ejecución."
  ports=$(docker port "$container")
  [[ -z $ports ]] || fail "$service publica puertos en el servidor."
done
printf 'Web, API, PostgreSQL y SeaweedFS disponibles. Puertos internos sin publicar.\n'

stamp=$(openssl rand -hex 8)
email=${email:-smoke-$stamp@example.test}
password="Nexus$(openssl rand -hex 16)1"
printf '{"fullName":"Prueba Nexus","organizationName":"Prueba de instalación %s","email":"%s","password":"%s"}' "$stamp" "$email" "$password" |
  "${http[@]}" "${json[@]}" "$api/auth/register" -o "$temp/register.json" || fail 'El registro de prueba falló.'
jq -e '.organizationId | length > 0' "$temp/register.json" >/dev/null || fail 'El registro no devolvió una organización.'
printf 'Cuenta de prueba registrada (%s).\n' "$email"

if [[ $verify == true ]]; then
  printf 'Pega el enlace o token de verificación recibido por correo: ' >&2
  IFS= read -rs verification || fail 'No se recibió el token de verificación.'
  printf '\n' >&2
  verification=${verification#*token=}
  verification=${verification%%&*}
  [[ $verification =~ ^[a-zA-Z0-9_-]+$ ]] || fail 'Formato de token de verificación inválido.'
  printf '{"token":"%s"}' "$verification" |
    "${http[@]}" "${json[@]}" "$api/auth/verify-email" -o /dev/null || fail 'La verificación del correo falló.'
  unset verification
  printf 'Correo de prueba verificado.\n'
else
  printf 'Verificación omitida por configuración local. Usa --verify con SMTP para probarla.\n'
fi

printf '{"email":"%s","password":"%s"}' "$email" "$password" |
  "${http[@]}" "${json[@]}" "$api/auth/login" -o "$temp/login.json" || fail 'El inicio de sesión falló.'
jq -er '.accessToken | select(length > 0) | "Authorization: Bearer " + .' "$temp/login.json" >"$temp/auth" ||
  fail 'El inicio de sesión no devolvió un token.'
unset password
auth=(--header "@$temp/auth")
"${http[@]}" "${auth[@]}" "$api/folders" -o "$temp/folders.json"
folder=$(jq -er '.drive.rootFolderId | select(length > 0)' "$temp/folders.json")
printf 'Archivo sintético de prueba Nexus %s\n' "$stamp" >"$temp/original.txt"
IFS= read -r idempotency_key </proc/sys/kernel/random/uuid
"${http[@]}" "${auth[@]}" -H "Idempotency-Key: $idempotency_key" --form-string "folderId=$folder" \
  -F "file=@$temp/original.txt;filename=prueba-instalacion.txt;type=text/plain" "$api/files/upload" -o "$temp/upload.json" ||
  fail 'La carga de prueba falló.'
file=$(jq -er '.id | select(length > 0)' "$temp/upload.json")
"${http[@]}" "${auth[@]}" "$api/files/$file/download" -o "$temp/download.txt" || fail 'La descarga de prueba falló.'
cmp -s "$temp/original.txt" "$temp/download.txt" || fail 'El archivo descargado difiere del original.'
printf 'Sesión iniciada, archivo cargado y descarga idéntica byte a byte.\n'
