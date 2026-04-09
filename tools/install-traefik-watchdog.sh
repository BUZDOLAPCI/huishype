#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="${1:-root@94.130.105.129}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPS_DIR="$SCRIPT_DIR/ops"
REMOTE_CONFIG_PATH="/etc/default/traefik-watchdog"

config_exists_on_remote() {
  ssh "$TARGET_HOST" "test -f '$REMOTE_CONFIG_PATH'"
}

write_config_seed() {
  local config_file
  config_file="$(mktemp)"

  cat >"$config_file" <<EOF
APP_LABEL=${APP_LABEL:?Set APP_LABEL when seeding a fresh watchdog config}
APP_NETWORK=${APP_NETWORK:?Set APP_NETWORK when seeding a fresh watchdog config}
PROXY_CONTAINER=${PROXY_CONTAINER:?Set PROXY_CONTAINER when seeding a fresh watchdog config}
FAILURE_THRESHOLD=${FAILURE_THRESHOLD:-3}
COOLDOWN_SECONDS=${COOLDOWN_SECONDS:-300}
PUBLIC_TIMEOUT_SECONDS=${PUBLIC_TIMEOUT_SECONDS:-8}
INTERNAL_TIMEOUT_SECONDS=${INTERNAL_TIMEOUT_SECONDS:-10}
RECOVERY_SETTLE_SECONDS=${RECOVERY_SETTLE_SECONDS:-10}
WEB_PUBLIC_URL=${WEB_PUBLIC_URL:?Set WEB_PUBLIC_URL when seeding a fresh watchdog config}
API_PUBLIC_URL=${API_PUBLIC_URL:?Set API_PUBLIC_URL when seeding a fresh watchdog config}
WEB_INTERNAL_URL=${WEB_INTERNAL_URL:?Set WEB_INTERNAL_URL when seeding a fresh watchdog config}
API_INTERNAL_URL=${API_INTERNAL_URL:?Set API_INTERNAL_URL when seeding a fresh watchdog config}
EOF

  scp "$config_file" "$TARGET_HOST:/tmp/traefik-watchdog.env"
  rm -f "$config_file"
}

scp "$OPS_DIR/traefik-watchdog.sh" "$TARGET_HOST:/tmp/traefik-watchdog.sh"
scp "$OPS_DIR/traefik-watchdog.service" "$TARGET_HOST:/tmp/traefik-watchdog.service"
scp "$OPS_DIR/traefik-watchdog.timer" "$TARGET_HOST:/tmp/traefik-watchdog.timer"

if ! config_exists_on_remote; then
  write_config_seed
fi

ssh "$TARGET_HOST" <<'EOF'
install -m 0755 /tmp/traefik-watchdog.sh /usr/local/bin/traefik-watchdog.sh
install -m 0644 /tmp/traefik-watchdog.service /etc/systemd/system/traefik-watchdog.service
install -m 0644 /tmp/traefik-watchdog.timer /etc/systemd/system/traefik-watchdog.timer

if [ -f /tmp/traefik-watchdog.env ] && [ ! -f /etc/default/traefik-watchdog ]; then
  install -m 0644 /tmp/traefik-watchdog.env /etc/default/traefik-watchdog
fi

rm -f /tmp/traefik-watchdog.env

systemctl daemon-reload
systemctl enable --now traefik-watchdog.timer
EOF
