# Sub Store

黑、白、灰液态玻璃风格的 Sub-Store 前端，基于 [sub-store-org/Sub-Store-Front-End](https://github.com/sub-store-org/Sub-Store-Front-End)。

## 特点

- **液态玻璃主题**：卡片、顶栏、底栏和弹窗都是半透明磨砂玻璃，亮色和暗色下文字对比度都达到 WCAG AA。设置里仍可切换上游的其他主题。
- **动效**：页面切换淡入或左右滑动，底栏玻璃胶囊跟随选中的标签滑动，按下有回弹，弹窗和通知有进出场动画。系统开启「减弱动态效果」时全部关闭。
- **加载快**：首页只下载订阅页用到的代码和当前语言，其他标签页在空闲时预取，编辑器、日志和二维码库用到时才加载。首页脚本约 0.71 MB（gzip 后约 240 KB）。
- **登录网关**（可选）：管理密码、通行密钥、密码管理器自动填充，见 [auth-gateway/README.md](auth-gateway/README.md)。

## 部署

一键脚本，需要 Linux、root 和 `curl unzip sha256sum realpath flock`，新装还需要 systemd：

```bash
curl -fsSL https://raw.githubusercontent.com/Ethan2258/sub-store/master/scripts/deploy.sh | bash
```

脚本会校验下载的 SHA-256。已有安装只更新前端，旧版本保留；回滚时停止服务，把前端符号链接指回上一版再启动。Docker 需要把前端目录单独挂载出来，没挂载时脚本会给出具体步骤。新装的服务只监听 `127.0.0.1:3001`，请自己配 HTTPS 反向代理（参考 `auth-gateway/nginx.conf.example`）。

也可以手动部署，让后端同时提供前端页面：

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

然后通过 HTTPS 反向代理访问，在前端里填上同样的后端路径，不要把后端端口直接开放到公网。用 Docker（如 `xream/sub-store`）时，把 `dist` 挂载进容器，并让 `SUB_STORE_FRONTEND_PATH` 指向它。

## 发布与同步

- `master` 每次改动都会自动发布 [Release](../../releases)（只改文档时不发布）。最新版可直接下载 `releases/latest/download/dist.zip`，旁边的 `.sha256` 是校验和。
- 每天自动同步上游，构建和检查通过后才合并并发布。有冲突时会开 PR 或 Issue 等待手动处理；上游改了工作流文件时，需要一个带 `workflow` 权限的 `SYNC_TOKEN` 密钥才能自动处理。

## 本地开发

需要 Node.js 24 和 pnpm 11。

```bash
corepack enable
pnpm i
pnpm dev     # http://127.0.0.1:8888/
pnpm build
```

CI 还会跑 `pnpm check:locales`、`pnpm check:gateway`（先 `npm ci --prefix auth-gateway --ignore-scripts`）和 `node scripts/check-release.mjs`。

## 许可证

[GPL-3.0](LICENSE)，版权和第三方许可证见 [NOTICE](NOTICE)。

```
Copyright (C) Sub-Store 前端的原作者和贡献者
Copyright (C) 2026 ZHENG YI HENG（本仓库的修改）
```

本仓库的修改同样按 GPL-3.0 提供，可以在[与上游的对比](https://github.com/sub-store-org/Sub-Store-Front-End/compare/master...Ethan2258:sub-store:master)里查看。每个 Release 的压缩包都附带 `LICENSE` 和 `NOTICE`，发布说明里有对应源代码的链接。第三方代码保留各自的许可证：`src/views/editCode/` 下两处来自 CodeMirror（MIT），`auth-gateway/public/webauthn-browser.js` 来自 [@simplewebauthn/browser](https://github.com/MasterKale/SimpleWebAuthn)（MIT）。

## 致谢

- [Sub-Store](https://github.com/sub-store-org/Sub-Store) 与前端上游的维护者。
- @KOP-XIAO 的 resource-parser。
- @Orz-3 和 @58xinian 的图标。
