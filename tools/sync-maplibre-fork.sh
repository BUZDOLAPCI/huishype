#!/usr/bin/env bash
# sync-maplibre-fork.sh — Sync our MapLibre React Native fork with upstream beta.
#
# What it does:
#   1. Fetches latest upstream beta branch
#   2. Merges upstream/beta into our huishype branch
#   3. Rebuilds lib/ (TypeScript → JS via bob build)
#   4. Commits the updated lib/
#   5. Pushes to origin
#   6. Updates the commit hash in apps/app/package.json
#   7. Runs pnpm install to update the lockfile
#
# Prerequisites:
#   - yarn available (corepack enable)
#   - Fork cloned at ../maplibre-react-native (sibling to huishype)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FORK_DIR="$(cd "$REPO_ROOT/../maplibre-react-native" 2>/dev/null && pwd)" || true

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}[sync]${NC} $1"; }
warn() { echo -e "${YELLOW}[sync]${NC} $1"; }
err()  { echo -e "${RED}[sync]${NC} $1"; exit 1; }

if [ -z "$FORK_DIR" ] || [ ! -d "$FORK_DIR/.git" ]; then
  err "Fork not found at $REPO_ROOT/../maplibre-react-native"
fi

# ── Fetch & merge upstream ──────────────────────────────────────────────────
cd "$FORK_DIR"

CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "huishype" ]; then
  err "Expected branch 'huishype', got '$CURRENT_BRANCH'. Switch to huishype first."
fi

log "Fetching upstream..."
git fetch upstream --tags

BEFORE_SHA=$(git rev-parse HEAD)
UPSTREAM_HEAD=$(git rev-parse upstream/beta)

if [ "$BEFORE_SHA" = "$UPSTREAM_HEAD" ]; then
  log "Already up to date with upstream/beta"
else
  log "Merging upstream/beta..."
  git merge upstream/beta --no-edit

  # ── Rebuild lib/ ────────────────────────────────────────────────────────
  log "Installing dependencies..."
  yarn install

  log "Building lib/..."
  npx bob build

  log "Committing updated lib/..."
  git add -A
  # Only commit if there are changes
  if ! git diff --cached --quiet; then
    UPSTREAM_DESC=$(git log upstream/beta --oneline -1 | cut -d' ' -f2-)
    git commit -m "chore: sync upstream beta — $UPSTREAM_DESC"
  fi

  log "Pushing to origin..."
  git push origin huishype
fi

# ── Update huishype project ────────────────────────────────────────────────
NEW_SHA=$(git rev-parse --short HEAD)
cd "$REPO_ROOT"

log "Updating apps/app/package.json to commit ${BOLD}$NEW_SHA${NC}..."
# Use sed for the in-place replacement of the commit hash
sed -i "s|github:BUZDOLAPCI/maplibre-react-native#[a-f0-9]*|github:BUZDOLAPCI/maplibre-react-native#$NEW_SHA|" apps/app/package.json

log "Running pnpm install..."
pnpm install

log "Done! MapLibre fork synced to upstream/beta ($NEW_SHA)"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Run: pnpm -C apps/app typecheck"
echo "  2. Run: pnpm -C apps/app test"
echo "  3. Test on device: npx expo run:android"
echo "  4. Commit the package.json + pnpm-lock.yaml changes"
