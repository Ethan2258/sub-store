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

## 自动发布

- `master` 每次有改动都会构建，并发布一个带 `dist.zip` 的新 [Release](../../releases)，说明里列出本次改动。只改文档、许可证、Issue 模板时不发布。
- 标签格式是 `版本号-运行编号`，例如 `2.34.0-12`。最新一版可以直接用 `releases/latest/download/dist.zip` 下载。
- PR 只构建、不发布，用来提前发现构建错误。

## 同步上游

- 每天拉取上游 `master` 并合并到本仓库，合并后自动发布新 Release。上游对 README 和发布工作流的改动会被忽略，保留本仓库的版本。
- 其他文件有冲突，或上游改了工作流文件（默认令牌推不了），会开一个「同步上游更新」的 PR 并让工作流失败，需要手动处理。想让后一种情况自动合并，可以加一个带 `workflow` 权限的 `SYNC_TOKEN` 密钥。

## 部署

需要 Node.js 和 Sub-Store 后端的 `sub-store.bundle.js`。后端可以同时提供前端页面，前后端共用一个端口：

```bash
mkdir -p ~/sub-store && cd ~/sub-store
curl -fLO https://github.com/sub-store-org/Sub-Store/releases/latest/download/sub-store.bundle.js
curl -fLO https://github.com/Ethan2258/sub-store/releases/latest/download/dist.zip
rm -rf dist && unzip -q dist.zip

SUB_STORE_BACKEND_MERGE=true \
SUB_STORE_BACKEND_API_PORT=3001 \
SUB_STORE_FRONTEND_PATH="$PWD/dist" \
SUB_STORE_FRONTEND_BACKEND_PATH=/换成一串随机路径 \
node sub-store.bundle.js
```

然后打开 `http://<机器地址>:3001/?api=http://<机器地址>:3001/<随机路径>`。更新前端时重新下载 `dist.zip` 并解压覆盖 `dist` 即可，不用重启后端。

用 Docker 部署时（如 `xream/sub-store` 镜像），把解压出的 `dist` 挂载到容器里，并把 `SUB_STORE_FRONTEND_PATH` 指向它。

## 本地开发

需要 Node.js 24 和 pnpm 11。

```bash
corepack enable
pnpm i
pnpm dev
pnpm build
```

开发服务器默认地址是 http://127.0.0.1:8888/ 。

## 许可证

GPL-3.0。

## 致谢

- [Sub-Store](https://github.com/sub-store-org/Sub-Store) 与前端上游的维护者。
- @KOP-XIAO 的 resource-parser。
- @Orz-3 和 @58xinian 的图标。
