#!/usr/bin/env bash
# Deploys or updates this frontend on a Linux server.
#
#   curl -fsSL https://raw.githubusercontent.com/Ethan2258/sub-store/master/scripts/deploy.sh | bash
#
# - A running Sub-Store (Docker container or node process) only gets its
#   frontend files replaced with the latest release; its data is untouched.
# - Otherwise Node.js, the Sub-Store backend and this frontend are installed
#   under /opt/sub-store and run as the `sub-store` systemd service, serving
#   frontend and API on one port.
#
# Run it again at any time to update to the newest release.
set -euo pipefail

REPO="${SUB_STORE_REPO:-Ethan2258/sub-store}"
DIR="${SUB_STORE_DIR:-/opt/sub-store}"
PORT="${SUB_STORE_PORT:-3001}"
DIST_URL="https://github.com/${REPO}/releases/latest/download/dist.zip"
BACKEND_URL="https://github.com/sub-store-org/Sub-Store/releases/latest/download/sub-store.bundle.js"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m错误：\033[0m%s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "请用 root 运行（或加 sudo）。"
command -v curl >/dev/null || die "需要 curl。"

install_pkg() {
  if command -v apt-get >/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
  elif command -v dnf >/dev/null; then dnf install -y -q "$@"
  elif command -v yum >/dev/null; then yum install -y -q "$@"
  elif command -v apk >/dev/null; then apk add --no-cache "$@"
  else die "找不到包管理器，请先手动安装：$*"
  fi
}

command -v unzip >/dev/null || { log "安装 unzip"; install_pkg unzip; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log "下载最新前端：${DIST_URL}"
curl -fsSL "$DIST_URL" -o "$WORK/dist.zip"
unzip -q "$WORK/dist.zip" -d "$WORK"
[[ -f "$WORK/dist/index.html" ]] || die "dist.zip 里没有 index.html。"

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DIR/backups"

# Replaces the contents of a host directory with the new build, keeping a backup.
replace_dir() {
  local target="$1"
  if [[ -d "$target" ]] && [[ -n "$(ls -A "$target" 2>/dev/null)" ]]; then
    tar -czf "$DIR/backups/frontend-${STAMP}.tar.gz" -C "$target" .
    log "旧前端已备份到 $DIR/backups/frontend-${STAMP}.tar.gz"
  fi
  mkdir -p "$target"
  find "$target" -mindepth 1 -delete
  cp -a "$WORK/dist/." "$target/"
}

public_ip() {
  curl -fsS -m 5 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}'
}

# 1. Existing Docker container.
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  container="$(docker ps --format '{{.Names}} {{.Image}}' | awk 'tolower($0) ~ /sub-?store/ {print $1; exit}')"
  if [[ -n "$container" ]]; then
    front="$(docker exec "$container" printenv SUB_STORE_FRONTEND_PATH 2>/dev/null || true)"
    front="${front:-/opt/app/frontend}"
    log "发现正在运行的容器 ${container}，前端目录 ${front}"
    host_dir="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "'"$front"'"}}{{.Source}}{{end}}{{end}}' "$container")"
    if [[ -n "$host_dir" ]]; then
      replace_dir "$host_dir"
      log "已更新挂载目录 ${host_dir}"
    else
      docker cp "$container:$front" "$DIR/backups/frontend-${STAMP}" >/dev/null 2>&1 &&
        log "旧前端已备份到 $DIR/backups/frontend-${STAMP}"
      docker exec "$container" sh -c "mkdir -p '$front' && find '$front' -mindepth 1 -delete"
      docker cp "$WORK/dist/." "$container:$front/"
      log "已把新前端复制进容器。注意：重建容器后会恢复成镜像自带的前端，再运行一次本脚本即可。"
    fi
    log "完成，刷新浏览器即可看到新界面。"
    exit 0
  fi
fi

# 2. Existing node process started with SUB_STORE_FRONTEND_PATH.
for pid in $(pgrep -f 'sub-store' || true); do
  [[ "$pid" == "$$" ]] && continue
  [[ -r "/proc/$pid/environ" ]] || continue
  front="$(tr '\0' '\n' < "/proc/$pid/environ" | sed -n 's/^SUB_STORE_FRONTEND_PATH=//p' | head -n 1)"
  if [[ -n "$front" ]]; then
    log "发现正在运行的 Sub-Store 进程 ${pid}，前端目录 ${front}"
    replace_dir "$front"
    log "完成，前端已更新，不用重启，刷新浏览器即可。"
    exit 0
  fi
done

# 3. Fresh install.
log "没有找到正在运行的 Sub-Store，全新安装到 ${DIR}"
mkdir -p "$DIR/data"

NODE="$(command -v node || true)"
if [[ -z "$NODE" ]] || (( $("$NODE" -p 'process.versions.node.split(".")[0]') < 18 )); then
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "不支持的架构 $(uname -m)" ;;
  esac
  command -v xz >/dev/null || { log "安装 xz"; install_pkg xz-utils 2>/dev/null || install_pkg xz; }
  tarball="$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | awk "/linux-${arch}\\.tar\\.xz\$/ {print \$2}")"
  log "安装 Node.js：${tarball}"
  rm -rf "$DIR/node" && mkdir -p "$DIR/node"
  curl -fsSL "https://nodejs.org/dist/latest-v24.x/${tarball}" | tar -xJ -C "$DIR/node" --strip-components=1
  NODE="$DIR/node/bin/node"
fi

log "下载 Sub-Store 后端"
curl -fsSL "$BACKEND_URL" -o "$DIR/sub-store.bundle.js"
replace_dir "$DIR/frontend"

if [[ -f "$DIR/sub-store.env" ]]; then
  api_path="$(sed -n 's/^SUB_STORE_FRONTEND_BACKEND_PATH=//p' "$DIR/sub-store.env")"
else
  api_path="/$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cat > "$DIR/sub-store.env" <<EOF
SUB_STORE_BACKEND_MERGE=true
SUB_STORE_BACKEND_API_HOST=0.0.0.0
SUB_STORE_BACKEND_API_PORT=${PORT}
SUB_STORE_FRONTEND_PATH=${DIR}/frontend
SUB_STORE_FRONTEND_BACKEND_PATH=${api_path}
SUB_STORE_DATA_BASE_PATH=${DIR}/data
EOF
  chmod 600 "$DIR/sub-store.env"
fi
PORT="$(sed -n 's/^SUB_STORE_BACKEND_API_PORT=//p' "$DIR/sub-store.env")"

if command -v systemctl >/dev/null && [[ -d /run/systemd/system ]]; then
  cat > /etc/systemd/system/sub-store.service <<EOF
[Unit]
Description=Sub-Store
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=${DIR}/sub-store.env
WorkingDirectory=${DIR}
ExecStart=${NODE} ${DIR}/sub-store.bundle.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now sub-store >/dev/null 2>&1
  systemctl restart sub-store
else
  log "没有 systemd，改用后台进程运行（重启后需要再运行一次本脚本）"
  pkill -f "${DIR}/sub-store.bundle.js" 2>/dev/null || true
  (set -a; . "$DIR/sub-store.env"; set +a; cd "$DIR"; nohup "$NODE" "$DIR/sub-store.bundle.js" > "$DIR/sub-store.log" 2>&1 &)
fi

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "${PORT}/tcp" >/dev/null && log "已在 ufw 放行端口 ${PORT}"
fi

for _ in $(seq 1 20); do
  curl -fsS -m 2 "http://127.0.0.1:${PORT}${api_path}/api/utils/env" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS -m 2 "http://127.0.0.1:${PORT}${api_path}/api/utils/env" >/dev/null || die "后端没有起来，查看：journalctl -u sub-store -n 50"

ip="$(public_ip)"
log "部署完成。打开："
echo "    http://${ip}:${PORT}/?api=http://${ip}:${PORT}${api_path}"
echo "  云服务器还要在安全组里放行 TCP ${PORT} 端口。以后再运行一次本脚本即可更新到最新 Release。"
