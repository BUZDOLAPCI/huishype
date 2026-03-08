#!/usr/bin/env bash
# sync-maplibre-gl-fork.sh — Sync our MapLibre GL JS web fork with upstream.
#
# What it does:
#   1. Fetches latest upstream main branch / tag
#   2. Merges into our huishype branch
#   3. Rebuilds shaders and dist: npm run generate-shaders && npm run build-dist
#   4. Commits the updated dist/
#   5. Pushes to origin
#   6. Updates the commit hash in apps/app/package.json
#   7. Runs pnpm install to update the lockfile
#
# Usage:
#   ./tools/sync-maplibre-gl-fork.sh              # merge upstream/main
#   ./tools/sync-maplibre-gl-fork.sh v5.17.0      # merge a specific tag
#   ./tools/sync-maplibre-gl-fork.sh main          # merge a specific branch
#
# Prerequisites:
#   - npm available
#   - Fork cloned at ../maplibre-gl-js (sibling to huishype)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FORK_DIR="$(cd "$REPO_ROOT/../maplibre-gl-js" 2>/dev/null && pwd)" || true

UPSTREAM_REF="${1:-main}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}[sync-gl]${NC} $1"; }
warn() { echo -e "${YELLOW}[sync-gl]${NC} $1"; }
err()  { echo -e "${RED}[sync-gl]${NC} $1"; exit 1; }

if [ -z "$FORK_DIR" ] || [ ! -d "$FORK_DIR/.git" ]; then
  err "Fork not found at $REPO_ROOT/../maplibre-gl-js"
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

# Resolve the upstream ref — could be a tag (v5.17.0) or a branch (main)
if git rev-parse "refs/tags/$UPSTREAM_REF" >/dev/null 2>&1; then
  UPSTREAM_TARGET="refs/tags/$UPSTREAM_REF"
  UPSTREAM_DESC="tag $UPSTREAM_REF"
elif git rev-parse "upstream/$UPSTREAM_REF" >/dev/null 2>&1; then
  UPSTREAM_TARGET="upstream/$UPSTREAM_REF"
  UPSTREAM_DESC="branch $UPSTREAM_REF"
else
  err "Could not resolve upstream ref '$UPSTREAM_REF' as tag or branch"
fi

UPSTREAM_HEAD=$(git rev-parse "$UPSTREAM_TARGET")

if git merge-base --is-ancestor "$UPSTREAM_HEAD" HEAD 2>/dev/null; then
  log "Already up to date with $UPSTREAM_DESC ($UPSTREAM_HEAD)"
else
  log "Merging $UPSTREAM_DESC..."
  git merge "$UPSTREAM_TARGET" --no-edit

  # ── Rebuild shaders and dist ───────────────────────────────────────────
  log "Installing dependencies..."
  npm install

  log "Regenerating shaders..."
  npm run generate-shaders

  log "Building dist/..."
  npm run build-dist

  log "Committing updated dist/..."
  git add -A
  # Only commit if there are changes
  if ! git diff --cached --quiet; then
    git commit -m "chore: sync upstream $UPSTREAM_DESC — rebuild dist"
  fi

  log "Pushing to origin..."
  git push origin huishype
fi

# ── Update huishype project ────────────────────────────────────────────────
NEW_SHA=$(git rev-parse HEAD)
cd "$REPO_ROOT"

log "Updating apps/app/package.json to commit ${BOLD}${NEW_SHA:0:7}${NC}..."
# Use sed for the in-place replacement of the commit hash
sed -i "s|github:BUZDOLAPCI/maplibre-gl-js#[a-f0-9]*|github:BUZDOLAPCI/maplibre-gl-js#$NEW_SHA|" apps/app/package.json

log "Running pnpm install..."
pnpm install

log "Done! MapLibre GL JS fork synced to $UPSTREAM_DESC ($NEW_SHA)"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Run: pnpm -C apps/app typecheck"
echo "  2. Run: pnpm -C apps/app test"
echo "  3. Test on web: open browser, hard-refresh (Ctrl+Shift+R)"
echo "  4. Commit the package.json + pnpm-lock.yaml changes"
