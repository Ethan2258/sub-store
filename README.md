# Sub Store

Sub-Store 前端。在上游界面上改成黑、白、灰，并加上液态玻璃：半透明卡片、顶栏和弹窗，背后有模糊和高光。

上游项目：[sub-store-org/Sub-Store-Front-End](https://github.com/sub-store-org/Sub-Store-Front-End)

默认的日间和夜间主题都叫「液态玻璃」。设置里仍可切换上游自带的其他主题。

## 自动更新

- 每天拉取上游 `master` 并合并到本仓库，合并后自动发布新 Release。上游对 README 和发布工作流的改动会被忽略，保留本仓库的版本。
- 其他文件有冲突，或上游改了工作流文件（默认令牌推不了），会开一个「同步上游更新」的 PR 并让工作流失败，需要手动处理。想让后一种情况自动合并，可以加一个带 `workflow` 权限的 `SYNC_TOKEN` 密钥。
- 主题、依赖或版本有改动时自动构建，并发布带 `dist.zip` 的 Release。PR 只构建不发布。

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
