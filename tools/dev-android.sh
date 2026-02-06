#!/usr/bin/env bash
# dev-android.sh — Ensure the full Android dev environment is running.
#
# Idempotent: safe to run multiple times. Skips anything already running.
#
# What it does:
#   1. Starts Docker services (PostgreSQL + Redis) if not already running
#   2. Starts the API server if port 3100 is not already serving
#   3. Detects LAN IP and sets EXPO_PUBLIC_API_URL
#   4. Starts Metro bundler with --dev-client (foreground)
#
# Prerequisites:
#   - Dev client APK installed on phone
#   - Phone and dev machine on the same WiFi network

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}[dev]${NC} $1"; }
warn() { echo -e "${YELLOW}[dev]${NC} $1"; }
err()  { echo -e "${RED}[dev]${NC} $1"; }

port_listening() { ss -tlnH "sport = :$1" 2>/dev/null | grep -q .; }

get_lan_ip() {
  local ip=""
  if command -v ip &>/dev/null; then
    ip=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || true)
  fi
  if [ -z "$ip" ] && command -v hostname &>/dev/null; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  fi
  if [ -z "$ip" ]; then
    ip=$(ifconfig 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | head -1 | awk '{print $2}' || true)
  fi
  echo "$ip"
}

# ── Docker ───────────────────────────────────────────────────────────────────
if docker compose ps --status running 2>/dev/null | grep -q postgres; then
  log "Docker services already running"
else
  log "Starting Docker services..."
  docker compose up -d
  log "Waiting for PostgreSQL..."
  until docker compose exec -T postgres pg_isready -U huishype -q 2>/dev/null; do
    sleep 1
  done
  log "PostgreSQL ready"
fi

# ── LAN IP ───────────────────────────────────────────────────────────────────
LAN_IP=$(get_lan_ip)
if [ -z "$LAN_IP" ]; then
  err "Could not detect LAN IP. Make sure you're connected to WiFi."
  exit 1
fi
export EXPO_PUBLIC_API_URL="http://${LAN_IP}:3100"

# ── API server ───────────────────────────────────────────────────────────────
if port_listening 3100; then
  log "API already running on port 3100"
else
  log "Starting API server..."
  cd "$REPO_ROOT/services/api"
  nohup pnpm dev > /tmp/huishype-api.log 2>&1 &
  cd "$REPO_ROOT"
  log "Waiting for API..."
  for i in $(seq 1 30); do
    if port_listening 3100; then break; fi
    sleep 1
  done
  if port_listening 3100; then
    log "API ready on port 3100"
  else
    err "API failed to start. Check /tmp/huishype-api.log"
    exit 1
  fi
fi

# ── Summary + Metro ─────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  LAN IP: ${BOLD}${LAN_IP}${NC}"
echo -e "${CYAN}  API:    ${BOLD}http://${LAN_IP}:3100${NC}"
echo -e "${CYAN}  Metro:  ${BOLD}http://${LAN_IP}:8081${NC}"
echo -e "${CYAN}──────────────────────────────────────────────────${NC}"
echo -e "${CYAN}  Open the HuisHype dev client on your phone.${NC}"
echo -e "${CYAN}  Press Ctrl+C to stop Metro (other services stay running).${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
echo ""

cd "$REPO_ROOT/apps/app"
exec npx expo start --dev-client
