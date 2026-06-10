#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="${1:-root@94.130.105.129}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPS_DIR="$SCRIPT_DIR/ops"
REMOTE_CONFIG_PATH="/etc/default/property-tile-guardrail-watchdog"

config_exists_on_remote() {
  ssh "$TARGET_HOST" "test -f '$REMOTE_CONFIG_PATH'"
}

write_config_seed() {
  local config_file
  config_file="$(mktemp)"

  cat >"$config_file" <<EOF
# Host-local production guardrail config. This file is created only on first
# install and is preserved by reruns of tools/install-property-tile-guardrail-watchdog.sh.
SOURCE=${SOURCE:-prod-app-vm}
APP_LABEL=${APP_LABEL:-}
ALERT_TO=${ALERT_TO:-support@huishype.nl}
ALERT_REPEAT_SECONDS=${ALERT_REPEAT_SECONDS:-3600}
ROOT_WARNING_USED_PERCENT=${ROOT_WARNING_USED_PERCENT:-75}
ROOT_CRITICAL_USED_PERCENT=${ROOT_CRITICAL_USED_PERCENT:-85}
ROOT_EMERGENCY_USED_PERCENT=${ROOT_EMERGENCY_USED_PERCENT:-95}
ROOT_CRITICAL_MIN_FREE_BYTES=${ROOT_CRITICAL_MIN_FREE_BYTES:-42949672960}
DB_CRITICAL_MAX_BYTES=${DB_CRITICAL_MAX_BYTES:-139586437120}
GENERATED_CRITICAL_MAX_BYTES=${GENERATED_CRITICAL_MAX_BYTES:-42949672960}
RETAINED_GENERATION_CRITICAL_MAX=${RETAINED_GENERATION_CRITICAL_MAX:-3}
EOF

  scp "$config_file" "$TARGET_HOST:/tmp/property-tile-guardrail-watchdog.env"
  rm -f "$config_file"
}

scp "$OPS_DIR/property-tile-guardrail-watchdog.sh" "$TARGET_HOST:/tmp/property-tile-guardrail-watchdog.sh"
scp "$OPS_DIR/property-tile-guardrail-watchdog.service" "$TARGET_HOST:/tmp/property-tile-guardrail-watchdog.service"
scp "$OPS_DIR/property-tile-guardrail-watchdog.timer" "$TARGET_HOST:/tmp/property-tile-guardrail-watchdog.timer"

if ! config_exists_on_remote; then
  write_config_seed
fi

ssh "$TARGET_HOST" <<'EOF'
install -m 0755 /tmp/property-tile-guardrail-watchdog.sh /usr/local/bin/property-tile-guardrail-watchdog.sh
install -m 0644 /tmp/property-tile-guardrail-watchdog.service /etc/systemd/system/property-tile-guardrail-watchdog.service
install -m 0644 /tmp/property-tile-guardrail-watchdog.timer /etc/systemd/system/property-tile-guardrail-watchdog.timer

if [ -f /tmp/property-tile-guardrail-watchdog.env ] && [ ! -f /etc/default/property-tile-guardrail-watchdog ]; then
  install -m 0644 /tmp/property-tile-guardrail-watchdog.env /etc/default/property-tile-guardrail-watchdog
fi

rm -f /tmp/property-tile-guardrail-watchdog.env

systemctl daemon-reload
systemctl enable --now property-tile-guardrail-watchdog.timer
EOF
