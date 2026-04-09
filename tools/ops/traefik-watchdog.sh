#!/usr/bin/env bash
set -euo pipefail

APP_LABEL="${APP_LABEL:?APP_LABEL must be set in /etc/default/traefik-watchdog}"
APP_NETWORK="${APP_NETWORK:?APP_NETWORK must be set in /etc/default/traefik-watchdog}"
PROXY_CONTAINER="${PROXY_CONTAINER:?PROXY_CONTAINER must be set in /etc/default/traefik-watchdog}"
STATE_DIR="${STATE_DIR:-/var/lib/traefik-watchdog}"
LOCK_FILE="${LOCK_FILE:-$STATE_DIR/lock}"
STATUS_FILE="${STATUS_FILE:-$STATE_DIR/status}"
COOLDOWN_FILE="${COOLDOWN_FILE:-$STATE_DIR/last-recovery}"
FAILURE_THRESHOLD="${FAILURE_THRESHOLD:-3}"
COOLDOWN_SECONDS="${COOLDOWN_SECONDS:-300}"
PUBLIC_TIMEOUT_SECONDS="${PUBLIC_TIMEOUT_SECONDS:-8}"
INTERNAL_TIMEOUT_SECONDS="${INTERNAL_TIMEOUT_SECONDS:-10}"
RECOVERY_SETTLE_SECONDS="${RECOVERY_SETTLE_SECONDS:-10}"
RECONCILE_SETTLE_SECONDS="${RECONCILE_SETTLE_SECONDS:-3}"

declare -Ar PUBLIC_URLS=(
  [web]="${WEB_PUBLIC_URL:?WEB_PUBLIC_URL must be set in /etc/default/traefik-watchdog}"
  [api]="${API_PUBLIC_URL:?API_PUBLIC_URL must be set in /etc/default/traefik-watchdog}"
)

declare -Ar INTERNAL_URLS=(
  [web]="${WEB_INTERNAL_URL:?WEB_INTERNAL_URL must be set in /etc/default/traefik-watchdog}"
  [api]="${API_INTERNAL_URL:?API_INTERNAL_URL must be set in /etc/default/traefik-watchdog}"
)

mkdir -p "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

log() {
  printf '%s traefik-watchdog: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

status_key() {
  if [ -f "$STATUS_FILE" ]; then
    cat "$STATUS_FILE"
  fi
}

set_status() {
  local key="$1"
  local message="$2"
  local previous=""

  previous="$(status_key)"
  if [ "$previous" = "$key" ]; then
    return 0
  fi

  printf '%s\n' "$key" >"$STATUS_FILE"
  log "$message"
}

clear_status() {
  rm -f "$STATUS_FILE"
}

state_file_for() {
  printf '%s/failures-%s' "$STATE_DIR" "$1"
}

read_failures() {
  local file="$1"
  if [ -f "$file" ]; then
    cat "$file"
  else
    printf '0'
  fi
}

write_failures() {
  local service="$1"
  local count="$2"
  printf '%s\n' "$count" >"$(state_file_for "$service")"
}

reset_failures() {
  rm -f "$(state_file_for "$1")"
}

max_failures() {
  local max=0
  local service count

  for service in "$@"; do
    count="$(read_failures "$(state_file_for "$service")")"
    if [ "$count" -gt "$max" ]; then
      max="$count"
    fi
  done

  printf '%s' "$max"
}

in_cooldown() {
  if [ ! -f "$COOLDOWN_FILE" ]; then
    return 1
  fi

  local age
  age=$(( $(date +%s) - $(stat -c %Y "$COOLDOWN_FILE") ))
  [ "$age" -lt "$COOLDOWN_SECONDS" ]
}

touch_cooldown() {
  : >"$COOLDOWN_FILE"
}

check_public_code() {
  local url="$1"
  local code

  code="$(
    curl -4 -sS -o /dev/null \
      -w '%{http_code}' \
      -m "$PUBLIC_TIMEOUT_SECONDS" \
      --http1.1 \
      "$url" 2>/dev/null || true
  )"
  printf '%s' "${code:-000}"
}

code_is_ok() {
  case "$1" in
    2*|3*) return 0 ;;
    *) return 1 ;;
  esac
}

service_container() {
  docker ps \
    --filter "label=$APP_LABEL" \
    --filter "label=com.docker.compose.service=$1" \
    --format '{{.Names}}' \
    | head -1
}

container_health() {
  docker inspect --format '{{if .State.Running}}{{if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}{{else}}stopped{{end}}' "$1" 2>/dev/null || printf 'unknown'
}

container_internal_ok() {
  local container="$1"
  local url="$2"

  timeout "$INTERNAL_TIMEOUT_SECONDS" \
    docker exec "$container" sh -lc '
      url="$1"
      if command -v wget >/dev/null 2>&1; then
        wget -q -O /dev/null "$url"
      elif command -v curl >/dev/null 2>&1; then
        curl -fsS -o /dev/null "$url"
      else
        exit 127
      fi
    ' sh "$url" >/dev/null 2>&1
}

proxy_running() {
  [ "$(docker inspect --format '{{.State.Running}}' "$PROXY_CONTAINER" 2>/dev/null || printf 'false')" = "true" ]
}

proxy_has_network() {
  [ "$(docker inspect --format "{{if index .NetworkSettings.Networks \"$APP_NETWORK\"}}connected{{end}}" "$PROXY_CONTAINER" 2>/dev/null || true)" = "connected" ]
}

recheck_public_services() {
  local -n services_ref="$1"
  local -n broken_ref="$2"
  local service code

  broken_ref=()
  for service in "${services_ref[@]}"; do
    code="$(check_public_code "${PUBLIC_URLS[$service]}")"
    if code_is_ok "$code"; then
      reset_failures "$service"
      continue
    fi

    broken_ref+=("$service=$code")
  done
}

verify_internal_health() {
  local -n services_ref="$1"
  local service container health

  for service in "${services_ref[@]}"; do
    container="$(service_container "$service")"
    if [ -z "$container" ]; then
      set_status \
        "refusing-missing-container:$service" \
        "Public routing is degraded for $service, but no running $service container was found. Leaving proxy untouched."
      return 1
    fi

    health="$(container_health "$container")"
    if [ "$health" != "healthy" ] && [ "$health" != "running" ]; then
      set_status \
        "refusing-unhealthy:$service:$health" \
        "Public routing is degraded for $service, but container $container health is $health. Leaving proxy untouched."
      return 1
    fi

    if ! container_internal_ok "$container" "${INTERNAL_URLS[$service]}"; then
      set_status \
        "refusing-internal:$service" \
        "Public routing is degraded for $service, but container $container failed internal probe ${INTERNAL_URLS[$service]}. Leaving proxy untouched."
      return 1
    fi
  done

  return 0
}

reconcile_proxy_prerequisites() {
  local changed=false

  if ! proxy_running; then
    log "Proxy container $PROXY_CONTAINER is not running. Starting it."
    docker start "$PROXY_CONTAINER" >/dev/null
    changed=true
  fi

  if ! proxy_has_network; then
    log "Proxy container $PROXY_CONTAINER is missing app network $APP_NETWORK. Reconnecting."
    docker network connect "$APP_NETWORK" "$PROXY_CONTAINER" >/dev/null
    changed=true
  fi

  if [ "$changed" = true ]; then
    sleep "$RECONCILE_SETTLE_SECONDS"
  fi

  [ "$changed" = true ]
}

main() {
  local service code failures
  local -a degraded_services=()
  local -a degraded_details=()
  local -a still_broken=()

  for service in web api; do
    code="$(check_public_code "${PUBLIC_URLS[$service]}")"
    if code_is_ok "$code"; then
      reset_failures "$service"
      continue
    fi

    failures=$(( $(read_failures "$(state_file_for "$service")") + 1 ))
    write_failures "$service" "$failures"
    degraded_services+=("$service")
    degraded_details+=("$service=$code")
  done

  if [ "${#degraded_services[@]}" -eq 0 ]; then
    clear_status
    return 0
  fi

  if ! verify_internal_health degraded_services; then
    return 0
  fi

  if reconcile_proxy_prerequisites; then
    recheck_public_services degraded_services still_broken
    if [ "${#still_broken[@]}" -eq 0 ]; then
      clear_status
      log "Public routing recovered after proxy reconciliation."
      return 0
    fi
  fi

  failures="$(max_failures "${degraded_services[@]}")"
  if [ "$failures" -lt "$FAILURE_THRESHOLD" ]; then
    set_status \
      "waiting:$failures:${degraded_details[*]}" \
      "Public routing degraded for ${degraded_details[*]}. Waiting for $FAILURE_THRESHOLD consecutive failures before restarting $PROXY_CONTAINER."
    return 0
  fi

  if in_cooldown; then
    set_status \
      "cooldown:${degraded_details[*]}" \
      "Public routing is still degraded for ${degraded_details[*]}, but proxy recovery is in cooldown. App containers remain untouched."
    return 0
  fi

  log "Public routing degraded for ${degraded_details[*]} with healthy internals. Restarting $PROXY_CONTAINER only."
  touch_cooldown
  docker restart "$PROXY_CONTAINER" >/dev/null
  sleep "$RECOVERY_SETTLE_SECONDS"

  recheck_public_services degraded_services still_broken
  if [ "${#still_broken[@]}" -gt 0 ]; then
    set_status \
      "restart-failed:${still_broken[*]}" \
      "Proxy restart did not restore ${still_broken[*]}. App containers were left untouched."
    return 1
  fi

  clear_status
  log "Proxy routing restored after restarting $PROXY_CONTAINER."
}

main "$@"
