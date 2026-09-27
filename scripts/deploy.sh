#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 ZHENG YI HENG
set -euo pipefail
umask 022

REPO="${SUB_STORE_REPO:-Ethan2258/sub-store}"
DIR="${SUB_STORE_DIR:-/opt/sub-store}"
PORT="${SUB_STORE_PORT:-3001}"
log() { printf '==> %s\n' "$*"; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "请用 root 运行。"
for tool in curl unzip sha256sum realpath flock; do command -v "$tool" >/dev/null || die "请先安装 $tool。"; done
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "仓库名称无效。"
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT > 0 && PORT < 65536 )) || die "端口无效。"
[[ "$DIR" == /* && "$DIR" != *[[:space:]]* ]] || die "安装目录必须是无空格的绝对路径。"
DIR="$(realpath -m -- "$DIR")"
case "$DIR" in /|/opt|/usr|/var|/home|/root|/etc|/bin|/sbin|/tmp|/srv) die "拒绝使用系统目录。";; esac
mkdir -p "$DIR"
exec 9>"$DIR/.deploy.lock"
flock -n 9 || die "已有部署在进行。"
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT

release_tag="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")"
release_tag="${release_tag##*/}"
[[ "$release_tag" =~ ^[A-Za-z0-9._-]+$ && "$release_tag" != latest ]] || die "无法确定发布版本。"
base="https://github.com/$REPO/releases/download/$release_tag"
log "下载前端版本 $release_tag"
curl --retry 3 -fsSL "$base/dist.zip" -o "$WORK/dist.zip"
curl --retry 3 -fsSL "$base/dist.zip.sha256" -o "$WORK/dist.zip.sha256" || die "缺少校验和，停止部署。"
read -r checksum filename < "$WORK/dist.zip.sha256"
[[ "$checksum" =~ ^[a-fA-F0-9]{64}$ && "$filename" == dist.zip ]] || die "校验文件格式无效。"
printf '%s  %s\n' "$checksum" "$WORK/dist.zip" | sha256sum -c --quiet - || die "前端校验失败。"
unzip -Z1 "$WORK/dist.zip" > "$WORK/entries"
if grep -Eq '(^/|(^|/)\.\.(/|$)|\\)' "$WORK/entries"; then die "压缩包包含不安全路径。"; fi
unzip -q "$WORK/dist.zip" -d "$WORK"
[[ -f "$WORK/dist/index.html" && -f "$WORK/dist/LICENSE" ]] || die "发布包不完整。"
[[ -z "$(find "$WORK/dist" -type l -print -quit)" ]] || die "发布包不允许符号链接。"

PREVIOUS=""
TARGET=""
STAGED=""
replace_dir() {
  local requested="$1" parent name destination
  [[ "$requested" == /* && "$requested" != *[[:space:]]* ]] || die "前端目录必须是无空格的绝对路径。"
  parent="$(realpath -m -- "$(dirname -- "$requested")")"
  name="$(basename -- "$requested")"
  TARGET="$parent/$name"
  destination="$(realpath -m -- "$TARGET")"
  case "$destination" in /|/opt|/usr|/var|/home|/root|/etc|/bin|/sbin|/tmp|/srv|"$DIR"|"$DIR/data"|"$DIR/data/"*) die "拒绝覆盖系统或数据目录。";; esac
  [[ "$DIR/data/" != "$destination/"* ]] || die "拒绝覆盖数据目录的上级目录。"
  if [[ -e "$TARGET" ]]; then
    [[ -d "$TARGET" && -f "$TARGET/index.html" ]] || die "已有目录不是独立前端目录，拒绝覆盖。"
    [[ ! -e "$TARGET/sub-store.json" && ! -e "$TARGET/data" ]] || die "前端目录中检测到数据，拒绝覆盖。"
  fi
  mkdir -p "$parent/.substore-releases-$name"
  STAGED="$(mktemp -d "$parent/.substore-releases-$name/$release_tag.XXXXXX")"
  cp -a "$WORK/dist/." "$STAGED/"
  chmod -R a+rX "$STAGED"
  ln -s -- "$STAGED" "$STAGED.link"
  if [[ -L "$TARGET" ]]; then
    PREVIOUS="$(realpath -e -- "$TARGET")"
  elif [[ -e "$TARGET" ]]; then
    PREVIOUS="$parent/.substore-releases-$name/previous-$(date +%s)-$$"
    mv -- "$TARGET" "$PREVIOUS"
  fi
  if ! mv -Tf -- "$STAGED.link" "$TARGET"; then
    if [[ ! -e "$TARGET" && -n "$PREVIOUS" ]]; then mv -- "$PREVIOUS" "$TARGET"; fi
    die "前端切换失败，已尝试恢复旧目录。"
  fi
  log "前端已切换；上一个版本保留在专用版本目录。"
}
rollback() {
  if [[ -n "$PREVIOUS" ]]; then
    ln -s -- "$PREVIOUS" "$STAGED.rollback"
    mv -Tf -- "$STAGED.rollback" "$TARGET"
    log "已回滚前端。"
  fi
}

if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  containers="$(docker ps --format '{{.Names}} {{.Image}}' | awk 'tolower($0) ~ /sub-?store/ {print $1}')"
  if [[ -n "$containers" ]]; then
    [[ "$(wc -l <<<"$containers")" -eq 1 ]] || die "检测到多个容器，请明确选择前端目录后手动部署。"
    container="$containers"
    front="$(docker exec "$container" printenv SUB_STORE_FRONTEND_PATH 2>/dev/null || true)"
    [[ "$front" == /* ]] || die "容器没有明确的前端绝对路径。"
    host_dir="$(docker inspect -f '{{range .Mounts}}{{if eq .Type "bind"}}{{println .Destination .Source}}{{end}}{{end}}' "$container" | awk -v front="$front" '$1 == front {print $2}')"
    [[ -n "$host_dir" ]] || die "请先将独立前端目录持久化挂载到容器，再更新；不直接改容器可写层。"
    docker stop "$container" >/dev/null
    trap 'docker start "$container" >/dev/null 2>&1 || true; rm -rf -- "$WORK"' EXIT
    replace_dir "$host_dir"
    if ! docker start "$container" >/dev/null; then rollback; docker start "$container" >/dev/null; die "启动失败，已回滚。"; fi
    log "容器前端更新完成，请检查站点；旧版本保留可回滚。"
    exit 0
  fi
fi

for pid in $(pgrep -f 'sub-store' || true); do
  [[ "$pid" != "$$" && -r "/proc/$pid/environ" ]] || continue
  front="$(tr '\0' '\n' < "/proc/$pid/environ" | sed -n 's/^SUB_STORE_FRONTEND_PATH=//p' | head -n 1)"
  if [[ -n "$front" ]]; then
    [[ "$front" == /* ]] || front="$(readlink -f "/proc/$pid/cwd")/$front"
    replace_dir "$front"
    log "前端更新完成；未修改现有服务、后端或数据。"
    exit 0
  fi
done

command -v systemctl >/dev/null && [[ -d /run/systemd/system ]] || die "新安装需要 systemd，不自动启动 root 后台服务。"
[[ ! -e "$DIR/sub-store.env" && ! -e "$DIR/data" && ! -e /etc/systemd/system/sub-store.service ]] || die "检测到停止的已有安装，请先恢复原服务，避免覆盖配置。"
NODE="$(command -v node || true)"
if [[ -z "$NODE" ]] || (( $("$NODE" -p 'process.versions.node.split(".")[0]') < 22 )); then
  case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) die "不支持的架构。";; esac
  command -v xz >/dev/null || die "请先安装 xz。"
  sums="$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt)"
  read -r checksum tarball < <(awk "/linux-$arch\\.tar\\.xz$/" <<<"$sums")
  [[ "$checksum" =~ ^[a-fA-F0-9]{64}$ && "$tarball" =~ ^node-v[0-9.]+-linux-(x64|arm64)\.tar\.xz$ ]] || die "Node.js 校验文件无效。"
  node_version="${tarball#node-}"; node_version="${node_version%%-linux-*}"
  curl --retry 3 -fsSL "https://nodejs.org/dist/$node_version/$tarball" -o "$WORK/node.tar.xz"
  printf '%s  %s\n' "$checksum" "$WORK/node.tar.xz" | sha256sum -c --quiet - || die "Node.js 校验失败。"
  mkdir -p "$DIR/runtime/$node_version"
  tar -xJf "$WORK/node.tar.xz" -C "$DIR/runtime/$node_version" --strip-components=1
  NODE="$DIR/runtime/$node_version/bin/node"
fi
curl --retry 3 -fsSL https://api.github.com/repos/sub-store-org/Sub-Store/releases/latest -o "$WORK/backend-release.json"
"$NODE" --input-type=module - "$WORK/backend-release.json" > "$WORK/backend-asset" <<'NODE'
import fs from 'node:fs';
const release = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const asset = release.assets.find(asset => asset.name === 'sub-store.bundle.js');
if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') || !asset.browser_download_url.startsWith('https://github.com/sub-store-org/Sub-Store/releases/download/')) throw new Error('Missing backend digest or invalid release URL');
console.log(asset.browser_download_url);
console.log(asset.digest.slice(7));
NODE
backend_url="$(sed -n '1p' "$WORK/backend-asset")"
backend_checksum="$(sed -n '2p' "$WORK/backend-asset")"
curl --retry 3 -fsSL "$backend_url" -o "$WORK/sub-store.bundle.js"
printf '%s  %s\n' "$backend_checksum" "$WORK/sub-store.bundle.js" | sha256sum -c --quiet - || die "后端校验失败。"
install -m 644 "$WORK/sub-store.bundle.js" "$DIR/sub-store.bundle.js"
replace_dir "$DIR/frontend"
id sub-store >/dev/null 2>&1 || useradd --system --home-dir "$DIR/data" --shell /usr/sbin/nologin sub-store
install -d -o sub-store -g sub-store -m 700 "$DIR/data"
api_path="/$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
cat > "$DIR/sub-store.env" <<EOF
SUB_STORE_BACKEND_MERGE=true
SUB_STORE_BACKEND_API_HOST=127.0.0.1
SUB_STORE_BACKEND_API_PORT=$PORT
SUB_STORE_FRONTEND_PATH=$DIR/frontend
SUB_STORE_FRONTEND_BACKEND_PATH=$api_path
SUB_STORE_DATA_BASE_PATH=$DIR/data
EOF
chmod 600 "$DIR/sub-store.env"
cat > /etc/systemd/system/sub-store.service <<EOF
[Unit]
Description=Sub-Store
After=network-online.target
Wants=network-online.target

[Service]
User=sub-store
Group=sub-store
EnvironmentFile=$DIR/sub-store.env
WorkingDirectory=$DIR/data
ExecStart=$NODE $DIR/sub-store.bundle.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DIR/data
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now sub-store >/dev/null
for attempt in $(seq 1 20); do
  if curl -fsS -m 2 "http://127.0.0.1:$PORT$api_path/api/utils/env" >/dev/null 2>&1; then
    log "部署完成：仅监听 127.0.0.1:$PORT；请配置 HTTPS 反向代理，不要开放后端端口。"
    log "后端随机路径保存在 $DIR/sub-store.env，未打印到日志。"
    exit 0
  fi
  sleep 1
done
rollback
systemctl stop sub-store
die "后端健康检查失败，已停止新服务；请查看 journalctl -u sub-store。"
