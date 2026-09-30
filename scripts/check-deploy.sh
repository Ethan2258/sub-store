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

# The container frontend path comes from the Sub-Store process when the image
# sets it on the start command (xream/sub-store), else from the container env.
env SUB_STORE_FRONTEND_PATH=/opt/app/frontend sleep 30 &
app_pid=$!
container_pid="$app_pid"
container_env=""
docker() {
  case "$1" in
    top) printf 'PID\n%s\n' "$container_pid" ;;
    exec) [[ -n "$container_env" ]] && printf '%s\n' "$container_env" ;;
  esac
}
[[ "$(container_frontend_path app)" == /opt/app/frontend ]]
kill "$app_pid"
wait "$app_pid" 2>/dev/null || true
container_pid=""
container_env=/srv/frontend
[[ "$(container_frontend_path app)" == /srv/frontend ]]
container_env=""
[[ -z "$(container_frontend_path app)" ]]
printf 'Deployment checks passed: directory migration, atomic switch, rollback, protected paths, container frontend path.\n'
