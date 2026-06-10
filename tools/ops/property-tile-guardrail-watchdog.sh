#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${STATE_DIR:-/var/lib/property-tile-guardrail-watchdog}"
LOCK_FILE="${LOCK_FILE:-$STATE_DIR/lock}"
STATUS_FILE="${STATUS_FILE:-$STATE_DIR/status}"
LAST_ALERT_FILE="${LAST_ALERT_FILE:-$STATE_DIR/last-alert}"
SOURCE="${SOURCE:-prod-app-vm}"
APP_LABEL="${APP_LABEL:-}"
ALERT_TO="${ALERT_TO:-support@huishype.nl}"
ALERT_FROM="${ALERT_FROM:-}"
ALERT_REPLY_TO="${ALERT_REPLY_TO:-}"
ALERT_REPEAT_SECONDS="${ALERT_REPEAT_SECONDS:-3600}"

ROOT_WARNING_USED_PERCENT="${ROOT_WARNING_USED_PERCENT:-75}"
ROOT_CRITICAL_USED_PERCENT="${ROOT_CRITICAL_USED_PERCENT:-85}"
ROOT_EMERGENCY_USED_PERCENT="${ROOT_EMERGENCY_USED_PERCENT:-95}"
ROOT_CRITICAL_MIN_FREE_BYTES="${ROOT_CRITICAL_MIN_FREE_BYTES:-42949672960}"
DB_CRITICAL_MAX_BYTES="${DB_CRITICAL_MAX_BYTES:-139586437120}"
GENERATED_CRITICAL_MAX_BYTES="${GENERATED_CRITICAL_MAX_BYTES:-42949672960}"
GENERATED_GENERATION_CRITICAL_MAX="${GENERATED_GENERATION_CRITICAL_MAX:-${PROPERTY_TILE_PYRAMID_GUARDRAIL_GENERATED_GENERATION_MAX:-3}}"
RETAINED_GENERATION_CRITICAL_MAX="${RETAINED_GENERATION_CRITICAL_MAX:-3}"

mkdir -p "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

log() {
  printf '%s property-tile-guardrail-watchdog: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

raise_state() {
  local current="$1"
  local candidate="$2"
  case "$current:$candidate" in
    emergency:*) printf 'emergency' ;;
    critical:emergency) printf 'emergency' ;;
    critical:*) printf 'critical' ;;
    warning:emergency) printf 'emergency' ;;
    warning:critical) printf 'critical' ;;
    warning:*) printf 'warning' ;;
    ok:*) printf '%s' "$candidate" ;;
    *) printf '%s' "$candidate" ;;
  esac
}

safe_source() {
  printf '%s' "$SOURCE" | tr -cd 'A-Za-z0-9_.:-'
}

discover_container() {
  local service="$1"
  local env_name="$2"
  local configured="${!env_name:-}"

  if [ -n "$configured" ]; then
    printf '%s' "$configured"
    return 0
  fi

  if [ -n "$APP_LABEL" ]; then
    docker ps \
      --filter "label=$APP_LABEL" \
      --filter "label=com.docker.compose.service=$service" \
      --format '{{.Names}}' \
      | head -1
    return 0
  fi

  docker ps \
    --filter "label=com.docker.compose.service=$service" \
    --format '{{.Names}}' \
    | head -1
}

container_env() {
  local container="$1"
  local key="$2"
  docker exec "$container" printenv "$key" 2>/dev/null || true
}

mount_source() {
  local container="$1"
  local destination="$2"
  docker inspect \
    --format "{{range .Mounts}}{{if eq .Destination \"$destination\"}}{{.Source}}{{end}}{{end}}" \
    "$container" 2>/dev/null || true
}

path_bytes() {
  local path="$1"
  if [ -z "$path" ] || [ ! -e "$path" ]; then
    printf '0'
    return 0
  fi
  du -sb "$path" 2>/dev/null | awk '{print $1}'
}

psql_exec() {
  local postgres_container="$1"
  local db_user="$2"
  local db_name="$3"
  local sql_text="$4"
  docker exec -i "$postgres_container" psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$db_name" <<<"$sql_text"
}

write_host_observation() {
  local postgres_container="$1"
  local db_user="$2"
  local db_name="$3"
  local root_total="$4"
  local root_used="$5"
  local root_free="$6"
  local root_used_percent="$7"
  local postgres_bytes="$8"
  local photon_bytes="$9"
  local observed_epoch="${10}"
  local source_value

  source_value="$(safe_source)"
  psql_exec "$postgres_container" "$db_user" "$db_name" "
INSERT INTO property_tile_pyramid_guardrail_observations (
  source,
  observed_at,
  root_filesystem_bytes,
  root_filesystem_used_bytes,
  root_filesystem_free_bytes,
  root_filesystem_used_percent,
  postgres_volume_bytes,
  photon_volume_bytes,
  docker_volumes_json,
  updated_at
)
VALUES (
  '$source_value',
  to_timestamp($observed_epoch),
  $root_total,
  $root_used,
  $root_free,
  $root_used_percent,
  $postgres_bytes,
  $photon_bytes,
  jsonb_build_object(
    'postgresDataBytes', $postgres_bytes,
    'photonDataBytes', $photon_bytes
  ),
  now()
)
ON CONFLICT (source) DO UPDATE SET
  observed_at = EXCLUDED.observed_at,
  root_filesystem_bytes = EXCLUDED.root_filesystem_bytes,
  root_filesystem_used_bytes = EXCLUDED.root_filesystem_used_bytes,
  root_filesystem_free_bytes = EXCLUDED.root_filesystem_free_bytes,
  root_filesystem_used_percent = EXCLUDED.root_filesystem_used_percent,
  postgres_volume_bytes = EXCLUDED.postgres_volume_bytes,
  photon_volume_bytes = EXCLUDED.photon_volume_bytes,
  docker_volumes_json = EXCLUDED.docker_volumes_json,
  updated_at = now();
" >/dev/null
}

query_storage_state() {
  local postgres_container="$1"
  local db_user="$2"
  local db_name="$3"

  docker exec -i "$postgres_container" psql -v ON_ERROR_STOP=1 -At -F '|' -U "$db_user" -d "$db_name" <<'SQL'
WITH RECURSIVE tracked_relations(relation_name) AS (
  VALUES
    ('property_tile_candidate_source_snapshots'),
    ('property_tile_grouping_facts'),
    ('property_tile_listing_candidates'),
    ('property_tile_listing_facts'),
    ('property_tile_pyramid_members'),
    ('property_tile_pyramid_nodes'),
    ('property_tile_pyramid_tiles'),
    ('property_tile_pyramid_versions'),
    ('property_tile_social_facts')
),
relation_roots AS (
  SELECT relation_name, to_regclass('public.' || relation_name) AS oid
  FROM tracked_relations
),
relation_tree(relation_name, oid) AS (
  SELECT relation_name, oid
  FROM relation_roots
  WHERE oid IS NOT NULL
  UNION ALL
  SELECT rt.relation_name, i.inhrelid
  FROM relation_tree rt
  JOIN pg_inherits i ON i.inhparent = rt.oid
),
generated_storage AS (
  SELECT COALESCE(sum(pg_total_relation_size(oid)), 0)::bigint AS generated_bytes
  FROM relation_tree
),
generated_partition_children AS (
  SELECT
    parent.relname AS parent_relation_name,
    pg_get_expr(child.relpartbound, child.oid) AS partition_bound
  FROM pg_inherits inherits
  INNER JOIN pg_class parent ON parent.oid = inherits.inhparent
  INNER JOIN pg_namespace parent_namespace ON parent_namespace.oid = parent.relnamespace
  INNER JOIN pg_class child ON child.oid = inherits.inhrelid
  WHERE parent_namespace.nspname = 'public'
    AND parent.relname IN (
      'property_tile_grouping_facts',
      'property_tile_listing_candidates',
      'property_tile_listing_facts',
      'property_tile_pyramid_members',
      'property_tile_pyramid_nodes',
      'property_tile_pyramid_tiles',
      'property_tile_social_facts'
    )
),
generated_generation_counts AS (
  SELECT
    CAST(count(DISTINCT partition_bound) FILTER (
      WHERE parent_relation_name IN (
        'property_tile_pyramid_members',
        'property_tile_pyramid_nodes',
        'property_tile_pyramid_tiles'
      )
    ) AS int) AS pyramid_generation_count,
    CAST(count(DISTINCT partition_bound) FILTER (
      WHERE parent_relation_name IN (
        'property_tile_grouping_facts',
        'property_tile_listing_candidates',
        'property_tile_listing_facts',
        'property_tile_social_facts'
      )
    ) AS int) AS candidate_snapshot_count
  FROM generated_partition_children
),
retained_generations AS (
  SELECT count(DISTINCT id)::int AS retained_generation_count
  FROM (
    SELECT current_version_id AS id FROM property_tile_pyramid_current
    UNION ALL
    SELECT previous_version_id AS id FROM property_tile_pyramid_current
    UNION ALL
    SELECT id
    FROM property_tile_pyramid_versions
    WHERE status IN ('queued', 'building', 'validating', 'validated')
  ) retained
  WHERE id IS NOT NULL
)
SELECT
  pg_database_size(current_database())::bigint,
  (SELECT generated_bytes FROM generated_storage),
  (SELECT pyramid_generation_count FROM generated_generation_counts),
  (SELECT candidate_snapshot_count FROM generated_generation_counts),
  (SELECT retained_generation_count FROM retained_generations);
SQL
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

send_alert() {
  local api_container="$1"
  local subject="$2"
  local body="$3"
  local resend_key from reply_to payload

  resend_key="$(container_env "$api_container" RESEND_API_KEY)"
  from="${ALERT_FROM:-$(container_env "$api_container" EMAIL_FROM)}"
  reply_to="${ALERT_REPLY_TO:-$(container_env "$api_container" EMAIL_REPLY_TO)}"
  from="${from:-HuisHype <noreply@huishype.nl>}"
  reply_to="${reply_to:-support@huishype.nl}"

  if [ -z "$resend_key" ]; then
    log "Resend API key is unavailable from API container; alert skipped: $subject"
    return 0
  fi

  payload='{"from":"'"$(json_escape "$from")"'","to":["'"$(json_escape "$ALERT_TO")"'"],"reply_to":"'"$(json_escape "$reply_to")"'","subject":"'"$(json_escape "$subject")"'","text":"'"$(json_escape "$body")"'"}'
  curl -fsS -X POST 'https://api.resend.com/emails' \
    -H "Authorization: Bearer $resend_key" \
    -H 'Content-Type: application/json' \
    -d "$payload" >/dev/null || log "Failed to send Resend alert: $subject"
}

previous_status() {
  if [ -f "$STATUS_FILE" ]; then
    cat "$STATUS_FILE"
  fi
}

last_alert_age_seconds() {
  if [ ! -f "$LAST_ALERT_FILE" ]; then
    printf '999999999'
    return 0
  fi
  printf '%s' "$(( $(date +%s) - $(stat -c %Y "$LAST_ALERT_FILE") ))"
}

record_status() {
  printf '%s\n' "$1" >"$STATUS_FILE"
}

mark_alert_sent() {
  : >"$LAST_ALERT_FILE"
}

maybe_alert() {
  local api_container="$1"
  local state="$2"
  local key="$3"
  local message="$4"
  local previous

  previous="$(previous_status)"
  if [ "$state" = "ok" ]; then
    if [ -n "$previous" ] && [ "$previous" != "ok" ]; then
      send_alert "$api_container" "HuisHype property tile guardrails recovered" "$message"
      mark_alert_sent
    fi
    record_status "ok"
    return 0
  fi

  if [ "$previous" != "$key" ] || [ "$(last_alert_age_seconds)" -ge "$ALERT_REPEAT_SECONDS" ]; then
    send_alert "$api_container" "HuisHype property tile guardrails $state" "$message"
    mark_alert_sent
  fi
  record_status "$key"
}

main() {
  local api_container postgres_container photon_container
  local db_user db_name
  local root_line root_total root_used root_free root_percent_raw root_percent
  local postgres_mount photon_mount postgres_bytes photon_bytes observed_epoch
  local storage_line db_bytes generated_bytes generated_pyramid_count generated_candidate_count retained_count
  local state="ok"
  local -a reasons=()
  local key message

  api_container="$(discover_container api API_CONTAINER)"
  postgres_container="$(discover_container postgres POSTGRES_CONTAINER)"
  photon_container="$(discover_container photon PHOTON_CONTAINER)"

  if [ -z "$api_container" ] || [ -z "$postgres_container" ]; then
    log "Missing api or postgres container; api=$api_container postgres=$postgres_container"
    exit 1
  fi

  db_user="$(container_env "$postgres_container" POSTGRES_USER)"
  db_name="$(container_env "$postgres_container" POSTGRES_DB)"
  db_user="${db_user:-huishype}"
  db_name="${db_name:-huishype}"

  root_line="$(df -B1 --output=size,used,avail,pcent / | tail -1)"
  read -r root_total root_used root_free root_percent_raw <<<"$root_line"
  root_percent="${root_percent_raw%%%}"
  observed_epoch="$(date +%s)"

  postgres_mount="$(mount_source "$postgres_container" /var/lib/postgresql/data)"
  photon_mount=""
  if [ -n "$photon_container" ]; then
    photon_mount="$(mount_source "$photon_container" /photon/data)"
  fi
  postgres_bytes="$(path_bytes "$postgres_mount")"
  photon_bytes="$(path_bytes "$photon_mount")"

  write_host_observation \
    "$postgres_container" \
    "$db_user" \
    "$db_name" \
    "$root_total" \
    "$root_used" \
    "$root_free" \
    "$root_percent" \
    "$postgres_bytes" \
    "$photon_bytes" \
    "$observed_epoch"

  storage_line="$(query_storage_state "$postgres_container" "$db_user" "$db_name")"
  IFS='|' read -r db_bytes generated_bytes generated_pyramid_count generated_candidate_count retained_count <<<"$storage_line"

  if [ "$root_percent" -ge "$ROOT_EMERGENCY_USED_PERCENT" ]; then
    state="$(raise_state "$state" emergency)"
    reasons+=("root-disk-used-percent=$root_percent")
  elif [ "$root_percent" -ge "$ROOT_CRITICAL_USED_PERCENT" ]; then
    state="$(raise_state "$state" critical)"
    reasons+=("root-disk-used-percent=$root_percent")
  elif [ "$root_percent" -ge "$ROOT_WARNING_USED_PERCENT" ]; then
    state="$(raise_state "$state" warning)"
    reasons+=("root-disk-used-percent=$root_percent")
  fi

  if [ "$root_free" -lt "$ROOT_CRITICAL_MIN_FREE_BYTES" ]; then
    state="$(raise_state "$state" critical)"
    reasons+=("root-disk-free-bytes=$root_free")
  fi
  if [ "$db_bytes" -gt "$DB_CRITICAL_MAX_BYTES" ]; then
    state="$(raise_state "$state" critical)"
    reasons+=("db-bytes=$db_bytes")
  fi
  if [ "$generated_bytes" -gt "$GENERATED_CRITICAL_MAX_BYTES" ]; then
    state="$(raise_state "$state" critical)"
    reasons+=("generated-bytes=$generated_bytes")
  fi
  if [ "$generated_pyramid_count" -gt "$GENERATED_GENERATION_CRITICAL_MAX" ]; then
    state="$(raise_state "$state" critical)"
    reasons+=("generated-pyramid-generations=$generated_pyramid_count")
  fi
  if [ "$generated_candidate_count" -gt "$GENERATED_GENERATION_CRITICAL_MAX" ]; then
    state="$(raise_state "$state" critical)"
    reasons+=("generated-candidate-snapshots=$generated_candidate_count")
  fi
  if [ "$retained_count" -gt "$RETAINED_GENERATION_CRITICAL_MAX" ]; then
    state="$(raise_state "$state" critical)"
    reasons+=("retained-generations=$retained_count")
  fi
  key="$state:${reasons[*]:-healthy}"
  message="state=$state rootUsedPercent=$root_percent rootFreeBytes=$root_free dbBytes=$db_bytes generatedBytes=$generated_bytes generatedPyramidGenerations=$generated_pyramid_count generatedCandidateSnapshots=$generated_candidate_count retainedGenerations=$retained_count postgresVolumeBytes=$postgres_bytes photonVolumeBytes=$photon_bytes reasons=${reasons[*]:-healthy}"
  maybe_alert "$api_container" "$state" "$key" "$message"
  log "$message"
}

main "$@"
