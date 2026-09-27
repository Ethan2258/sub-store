# Sub Store

Sub-Store 前端。在上游界面上改成黑、白、灰，并加上液态玻璃效果。

上游项目：[sub-store-org/Sub-Store-Front-End](https://github.com/sub-store-org/Sub-Store-Front-End)

## 液态玻璃主题

默认的日间和夜间主题都叫「液态玻璃」。设置里仍可切换上游自带的其他主题。

- 卡片、顶栏、底栏和弹窗都是半透明磨砂玻璃，带描边、顶部高光和柔和阴影。
- 描边按钮是玻璃胶囊，底栏当前页下面垫一个玻璃胶囊。
- 顶部通知是磨砂玻璃圆角卡片，不再是整条彩色。
- 暗色背景有几处很淡的光晕，让玻璃的模糊效果看得出来。
- 亮色和暗色下文字对比度都达到 WCAG AA，没有灰底白字或白底白字。

## 加载速度

- 首页不再下载代码编辑器和 YAML 解析库，只在打开节点对比或文件预览时加载。打开首页要下载的脚本从约 1.87 MB 降到约 1.12 MB（gzip 后约 600 KB 降到 360 KB）。

## 登录网关

`auth-gateway/` 是可选的登录页，风格和前端一致，支持管理密码、通行密钥和 1Password 等密码管理器自动填充。用法见 [auth-gateway/README.md](auth-gateway/README.md)。

## 自动发布

- `master` 每次有改动都会构建，并发布一个带 `dist.zip` 和 `auth-gateway.zip`（登录网关）的新 [Release](../../releases)，说明里列出本次改动。只改 Markdown 文档时不发布；许可证变更会重新发布。
- 标签格式是 `版本号-运行编号`，例如 `2.34.0-12`。最新一版可以直接用 `releases/latest/download/dist.zip` 下载，旁边的 `.sha256` 文件是对应压缩包的 SHA-256 校验和。
- PR 会检查翻译、前端构建、网关认证回归、部署脚本语法和发布包授权，不发布。

## 同步上游

- 每天拉取上游 `master`，先完成依赖安装、认证回归、授权检查、翻译检查和构建，再合并到本仓库并自动发布新 Release。验证失败不会推入主分支。上游对 README、发布工作流和本仓库删掉的文件（Vercel 配置、Issue 模板、husky 提交钩子）的改动会被忽略，保留本仓库的版本。上游改了依赖时，会用上游的锁文件重新生成 `pnpm-lock.yaml`，本仓库的依赖覆盖（见下）会自动带上，不会因为锁文件冲突卡住。
- 其他文件有冲突，或上游改了工作流文件（默认令牌推不了），会把上游的 master 推到本仓库的 `upstream-sync` 分支，从它开一个「同步上游更新」的 PR，并让工作流失败，需要手动处理。上游改了工作流文件时默认令牌连这个分支也推不了，运行摘要里会写明手动合并的步骤；想让这种情况也能自动处理，可以加一个带 `workflow` 权限的 `SYNC_TOKEN` 密钥。

## 依赖安全

构建工具升级到 Vite 7，开发服务器默认只监听回环地址。构建工具依赖与运行依赖分开；兼容范围内的安全修复通过锁文件和 `pnpm-workspace.yaml` 的定向覆盖保留。Dependabot 每周检查前端及登录网关依赖，自动更新仍需通过 CI 后才能发布。

2026-09-27 的本地检查中，`pnpm audit --prod` 和网关 `npm audit --omit=dev` 均为零告警；完整开发依赖树仍有旧 SVG 工具链等告警，不代表已经消除所有开发工具风险。不要对公网暴露开发服务器。

## 部署

部署脚本要求 Linux、root，以及已安装的 `curl unzip sha256sum realpath flock`（Debian/Ubuntu 可安装 `curl unzip coreutils util-linux xz-utils`）。新安装需要 systemd。

```bash
curl -fsSL https://raw.githubusercontent.com/Ethan2258/sub-store/master/scripts/deploy.sh | bash
```

- 下载时先固定 Release 标签，前端校验和缺失或不匹配立即停止；新装后端也验证 GitHub 发布资产的 SHA-256。
- 已运行的 node 后端只更新独立前端目录，不改数据、后端和服务配置。首次迁移旧的真实目录时有短暂切换窗口；此后通过符号链接原子切换，旧版本保留在同级专用版本目录。
- Docker 必须挂载独立的前端目录；更新会短暂停止并重新启动容器以重新解析挂载路径。无持久化挂载、多容器不明确的情况会停止，而不是猜测覆盖。
- 新装服务以非 root 用户运行，仅监听 `127.0.0.1:3001`，不自动开放防火墙。请配置 HTTPS 反向代理；参考 `auth-gateway/nginx.conf.example`。
- 已有但停止的安装不会被当成新安装覆盖；先恢复原服务。后端随机路径只写入权限为 600 的环境文件，不打印到日志。
- 不自动删除旧版本。回滚时先停止相关服务，将前端符号链接切回上一个版本，再启动并检查站点。

也可以手动部署：

需要 Node.js 和 Sub-Store 后端的 `sub-store.bundle.js`。后端可以同时提供前端页面，前后端共用一个端口：

```bash
mkdir -p ~/sub-store && cd ~/sub-store
curl -fLO https://github.com/sub-store-org/Sub-Store/releases/latest/download/sub-store.bundle.js
curl -fLO https://github.com/Ethan2258/sub-store/releases/latest/download/dist.zip
rm -rf dist && unzip -q dist.zip

SUB_STORE_BACKEND_MERGE=true \
SUB_STORE_BACKEND_API_HOST=127.0.0.1 \
SUB_STORE_BACKEND_API_PORT=3001 \
SUB_STORE_FRONTEND_PATH="$PWD/dist" \
SUB_STORE_FRONTEND_BACKEND_PATH=/换成一串随机路径 \
node sub-store.bundle.js
```

然后通过 HTTPS 反向代理访问，并在前端配置同源后端随机路径。不要向公网开放未加密的后端端口。更新建议使用上面的校验及版本切换脚本。

用 Docker 部署时（如 `xream/sub-store` 镜像），把解压出的 `dist` 挂载到容器里，并把 `SUB_STORE_FRONTEND_PATH` 指向它。

## 本地开发

需要 Node.js 24 和 pnpm 11。

```bash
corepack enable
pnpm i
pnpm dev
pnpm build
npm ci --prefix auth-gateway --ignore-scripts
pnpm check:gateway
node scripts/check-release.mjs
```

开发服务器默认地址是 http://127.0.0.1:8888/ 。

## 许可证

本仓库是 [sub-store-org/Sub-Store-Front-End](https://github.com/sub-store-org/Sub-Store-Front-End) 的修改版，按 [GPL-3.0](LICENSE) 发布。版权和第三方许可证汇总在 [NOTICE](NOTICE)。

```
Copyright (C) Sub-Store 前端的原作者和贡献者
Copyright (C) 2026 ZHENG YI HENG（本仓库的修改）
```

- 上游代码的版权归上游作者。本仓库自 2026-09-26 起做的修改（液态玻璃主题、自动发布和同步工作流、部署脚本等）同样按 GPL-3.0 提供，具体改了什么可以在[与上游的对比](https://github.com/sub-store-org/Sub-Store-Front-End/compare/master...Ethan2258:sub-store:master)里看到。
- 登录网关 `auth-gateway/` 同样按 GPL-3.0 发布。本仓库自己写的文件（主题样式、登录网关、部署脚本、工作流）开头都标了 `SPDX-License-Identifier: GPL-3.0-only`。每个 Release 的 `dist.zip` 和 `auth-gateway.zip` 里都附带 `LICENSE` 和 `NOTICE`，发布说明里有这一版源代码的链接。
- 第三方代码保留各自的许可证：`src/views/editCode/` 下两处来自 CodeMirror（MIT），`auth-gateway/public/webauthn-browser.js` 是打包好的 [@simplewebauthn/browser](https://github.com/MasterKale/SimpleWebAuthn)（MIT）。

## 致谢

- [Sub-Store](https://github.com/sub-store-org/Sub-Store) 与前端上游的维护者。
- @KOP-XIAO 的 resource-parser。
- @Orz-3 和 @58xinian 的图标。
