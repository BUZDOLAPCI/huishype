#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="${1:-root@94.130.105.129}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPS_DIR="$SCRIPT_DIR/ops"

scp "$OPS_DIR/traefik-watchdog.sh" "$TARGET_HOST:/tmp/traefik-watchdog.sh"
scp "$OPS_DIR/traefik-watchdog.service" "$TARGET_HOST:/tmp/traefik-watchdog.service"
scp "$OPS_DIR/traefik-watchdog.timer" "$TARGET_HOST:/tmp/traefik-watchdog.timer"

ssh "$TARGET_HOST" <<'EOF'
install -m 0755 /tmp/traefik-watchdog.sh /usr/local/bin/traefik-watchdog.sh
install -m 0644 /tmp/traefik-watchdog.service /etc/systemd/system/traefik-watchdog.service
install -m 0644 /tmp/traefik-watchdog.timer /etc/systemd/system/traefik-watchdog.timer

cat >/etc/default/traefik-watchdog <<'ENV'
APP_LABEL=coolify.applicationId=1
APP_NETWORK=cop1e1822hijj6g3zmxhrs0k
PROXY_CONTAINER=coolify-proxy
FAILURE_THRESHOLD=3
COOLDOWN_SECONDS=300
PUBLIC_TIMEOUT_SECONDS=8
INTERNAL_TIMEOUT_SECONDS=10
RECOVERY_SETTLE_SECONDS=10
WEB_PUBLIC_URL=https://huishype.nl/
API_PUBLIC_URL=https://api.huishype.nl/health
WEB_INTERNAL_URL=http://127.0.0.1:80/
API_INTERNAL_URL=http://127.0.0.1:3100/health
ENV

systemctl daemon-reload
systemctl enable --now traefik-watchdog.timer
EOF
