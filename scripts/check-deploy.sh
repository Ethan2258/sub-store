#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf -- "$SANDBOX"' EXIT
DIR="$SANDBOX/install"
WORK="$SANDBOX/work"
release_tag=validation
mkdir -p "$DIR/data" "$WORK/dist"
printf 'new' > "$WORK/dist/index.html"
printf 'asset' > "$WORK/dist/asset.js"
log() { :; }
die() { printf '%s\n' "$*" >&2; exit 1; }
PREVIOUS=""; TARGET=""; STAGED=""
source <(sed -n '/^replace_dir() {/,/^if command -v docker/{ /^if command -v docker/d; p; }' "$ROOT/scripts/deploy.sh")
mkdir "$DIR/frontend"
printf 'old' > "$DIR/frontend/index.html"
replace_dir "$DIR/frontend"
[[ -L "$DIR/frontend" && "$(cat "$DIR/frontend/index.html")" == new ]]
[[ "$(cat "$PREVIOUS/index.html")" == old ]]
rollback
[[ "$(cat "$DIR/frontend/index.html")" == old ]]
replace_dir "$DIR/frontend"
[[ -L "$DIR/frontend" && "$(cat "$DIR/frontend/index.html")" == new ]]
mkdir "$DIR/not-a-frontend"
printf 'keep' > "$DIR/not-a-frontend/data.json"
if (replace_dir "$DIR/not-a-frontend") 2>/dev/null; then exit 1; fi
[[ "$(cat "$DIR/not-a-frontend/data.json")" == keep ]]
for unsafe in / /etc "$DIR" "$DIR/data" "$SANDBOX"; do
  if (replace_dir "$unsafe") 2>/dev/null; then exit 1; fi
done
printf 'Deployment checks passed: directory migration, atomic switch, rollback, protected paths.\n'
