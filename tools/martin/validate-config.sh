#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG_PATH="${MARTIN_CONFIG_PATH:-$ROOT_DIR/martin/config.yaml}"
SCHEMA_PATH="${MARTIN_SCHEMA_PATH:-/home/caslan/dev/git_repos/martin/schemas/config.json}"
MARTIN_IMAGE="${MARTIN_IMAGE:-ghcr.io/maplibre/martin:1.8.0}"
RUN_STARTUP_CHECK=0

usage() {
  cat <<'USAGE'
Usage: tools/martin/validate-config.sh [--startup]

Validates martin/config.yaml against the local Martin JSON schema and checks
that checked-in Martin config/style files do not use .pbf tile URL templates.

Options:
  --startup   Also start the Martin container briefly and fail on warnings,
              ignored/unrecognized keys, or early exit. Requires a usable
              database URL and required tile archive files.

Environment:
  MARTIN_CONFIG_PATH   Config path to validate.
  MARTIN_SCHEMA_PATH   Martin JSON schema path.
  MARTIN_IMAGE         Martin container image for --startup.
  MARTIN_DATABASE_URL  Database URL for --startup. When absent, DATABASE_URL is
                       read from services/api/.env and adapted for Docker.
USAGE
}

read_env_value() {
  local file_path="$1"
  local key="$2"
  local line value

  [[ -f "$file_path" ]] || return 1

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line//$'\r'/}"
    line="$(printf '%s' "$line" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" == export[[:space:]]* ]]; then
      line="${line#export}"
      line="$(printf '%s' "$line" | sed -E 's/^[[:space:]]+//')"
    fi
    [[ "$line" == "$key="* ]] || continue

    value="${line#*=}"
    if [[ "$value" == \"*\" && "$value" == *\" && "${#value}" -ge 2 ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'* && "$value" == *\' && "${#value}" -ge 2 ]]; then
      value="${value:1:${#value}-2}"
    fi

    printf '%s\n' "$value"
    return 0
  done <"$file_path"

  return 1
}

resolve_default_martin_database_url() {
  local env_file database_url

  for env_file in \
    "$ROOT_DIR/services/api/.env" \
    "$ROOT_DIR/services/api/.env.local" \
    "$ROOT_DIR/services/api/.env.example"; do
    if database_url="$(read_env_value "$env_file" DATABASE_URL)" && [[ -n "$database_url" ]]; then
      MARTIN_DATABASE_URL="$database_url"
      MARTIN_DATABASE_URL_SOURCE="$env_file DATABASE_URL"
      return 0
    fi
  done

  return 1
}

make_database_url_container_reachable() {
  local input_url="$1"
  local output_url="$input_url"

  output_url="${output_url//@localhost:/@host.docker.internal:}"
  output_url="${output_url//@127.0.0.1:/@host.docker.internal:}"
  output_url="${output_url//\/\/localhost:/\/\/host.docker.internal:}"
  output_url="${output_url//\/\/127.0.0.1:/\/\/host.docker.internal:}"

  printf '%s\n' "$output_url"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --startup)
      RUN_STARTUP_CHECK=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Martin config not found: $CONFIG_PATH" >&2
  exit 1
fi

if [[ ! -f "$SCHEMA_PATH" ]]; then
  echo "Martin schema not found: $SCHEMA_PATH" >&2
  exit 1
fi

uvx --from check-jsonschema check-jsonschema \
  --schemafile "$SCHEMA_PATH" \
  "$CONFIG_PATH"

if rg -n --glob 'config.yaml' --glob '*.json' '\.pbf(\b|[/?#"])' "$ROOT_DIR/martin"; then
  echo "Martin config/styles must not contain .pbf tile URL templates." >&2
  exit 1
fi

if [[ "$RUN_STARTUP_CHECK" -eq 0 ]]; then
  echo "Martin config schema validation passed."
  exit 0
fi

MARTIN_DATABASE_URL_SOURCE="explicit MARTIN_DATABASE_URL"
if [[ -z "${MARTIN_DATABASE_URL:-}" ]]; then
  if ! resolve_default_martin_database_url; then
    echo "MARTIN_DATABASE_URL is required for --startup and no DATABASE_URL was found in services/api/.env*." >&2
    exit 1
  fi
fi

CONTAINER_MARTIN_DATABASE_URL="$(make_database_url_container_reachable "$MARTIN_DATABASE_URL")"
DOCKER_HOST_ARGS=()
if [[ "$CONTAINER_MARTIN_DATABASE_URL" != "$MARTIN_DATABASE_URL" ]]; then
  DOCKER_HOST_ARGS=(--add-host=host.docker.internal:host-gateway)
  echo "Using $MARTIN_DATABASE_URL_SOURCE with host.docker.internal for Martin container access."
else
  echo "Using $MARTIN_DATABASE_URL_SOURCE for Martin startup validation."
fi

CONTAINER_NAME="huishype-martin-config-check-$$"
LOG_FILE="$(mktemp)"
DOCKER_NETWORK="${MARTIN_DOCKER_NETWORK:-}"
if [[ -z "$DOCKER_NETWORK" ]] && docker network inspect "${COMPOSE_PROJECT_NAME:-huishype}_default" >/dev/null 2>&1; then
  DOCKER_NETWORK="${COMPOSE_PROJECT_NAME:-huishype}_default"
fi
cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

DOCKER_NETWORK_ARGS=()
if [[ -n "$DOCKER_NETWORK" ]]; then
  DOCKER_NETWORK_ARGS=(--network "$DOCKER_NETWORK")
fi

docker run -d \
  --name "$CONTAINER_NAME" \
  "${DOCKER_HOST_ARGS[@]}" \
  "${DOCKER_NETWORK_ARGS[@]}" \
  -e MARTIN_DATABASE_URL="$CONTAINER_MARTIN_DATABASE_URL" \
  -v "$ROOT_DIR/martin/config.yaml:/config/config.yaml:ro" \
  -v "$ROOT_DIR/martin/styles:/config/styles:ro" \
  -v "$ROOT_DIR/martin/sprites:/config/sprites:ro" \
  -v "$ROOT_DIR/martin/fonts:/config/fonts:ro" \
  -v "$ROOT_DIR/martin/tiles:/data/tiles:ro" \
  "$MARTIN_IMAGE" \
  --config /config/config.yaml >/dev/null

sleep "${MARTIN_STARTUP_SECONDS:-8}"
docker logs "$CONTAINER_NAME" >"$LOG_FILE" 2>&1 || true

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  cat "$LOG_FILE" >&2
  echo "Martin exited during startup validation." >&2
  exit 1
fi

if rg -i '(ignored key|unrecognized key|unknown field|unknown key|deprecated config|Defaulting `pmtiles\.allow_http`)' "$LOG_FILE"; then
  echo "Martin startup emitted a config warning or ignored-key diagnostic." >&2
  exit 1
fi

echo "Martin startup log gate passed."
