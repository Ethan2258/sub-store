# 登录网关

给 Sub-Store 加一道登录页，界面和前端一样是黑白灰风格。支持管理密码和通行密钥（Passkey），1Password、iCloud 钥匙串等密码管理器可以直接填充。

- 没登录时 nginx 把请求交给网关检查，未通过就跳到 `/_auth/login`。
- 密码登录不刷新页面；错了就地提示，并选中密码方便重输。
- 添加过通行密钥后，点用户名或密码框时密码管理器会直接给出通行密钥；页面放久了也会自动换新的验证请求，不会出现「验证请求已过期」。
- 登录后访问 `/_auth/settings` 可以添加通行密钥或退出登录。
- 10 分钟内同一 IP 最多预占 5 次认证尝试（包含正在校验的请求），达到上限锁定 30 分钟；成功登录清除该 IP 计数。全局最多每分钟 60 次认证尝试、同时 4 次密码计算，超额返回 429。

## 运行

建议使用 Node.js 24 LTS。

```bash
npm ci --omit=dev
```

在 `/etc/substore-auth.env` 写好下面这些变量，再用 systemd 跑 `node server.mjs`：

| 变量 | 说明 |
| --- | --- |
| `ORIGIN` | 站点地址，例如 `https://sub.example.com` |
| `PASSWORD_SALT` / `PASSWORD_HASH` | 管理密码的 scrypt 盐和哈希（base64url） |
| `SESSION_SECRET` | 签名会话 Cookie 的随机密钥（base64url） |
| `STATE_FILE` | 可选，通行密钥存放位置，默认 `/var/lib/substore-auth/state.json` |
| `TRUST_PROXY` | 默认 `false`。仅在使用所附 nginx 配置、网关不对外暴露时设为 `true`；只接受回环连接携带的有效 `X-Client-IP` |
| `SESSION_TTL_SECONDS` | 默认 86400（24 小时），范围 300–604800；会话绑定客户端 IP |
| `PORT` | 可选，默认 `3102`，只监听 `127.0.0.1` |

生成密码哈希和会话密钥：

```bash
node -e 'const c=require("crypto"),p=process.argv[1],s=c.randomBytes(16);console.log("PASSWORD_SALT="+s.toString("base64url")+"\nPASSWORD_HASH="+c.scryptSync(p,s,32).toString("base64url")+"\nSESSION_SECRET="+c.randomBytes(32).toString("base64url"))' '你的管理密码'
```

## 部署与升级

- 参考 `nginx.conf.example`：替换域名与证书路径，放入 nginx 的 http 配置上下文。该模板对整个站点做登录保护，公开订阅下载或分享如需免登录，必须单独设计受限的访问规则，不要直接放开整个 API。
- nginx 在认证子请求和登录接口都强制覆盖 `X-Client-IP`；使用该模板时在环境文件设置 `TRUST_PROXY=true`。不要信任客户端自带的转发头。Cloudflare 等多级代理需另行限定可信代理地址段。
- 参考 `substore-auth.service.example`：网关目录放在 `/opt/substore-auth`，使用 systemd 动态非 root 用户和持久化 StateDirectory。环境文件权限设为 600，Node 路径按安装位置调整。
- 升级后旧 Cookie 全部失效，需要重新登录。新会话保存在进程内存中，退出立即撤销；重启会使全部会话失效，但持久化的通行密钥不丢失。不支持多个网关进程共享会话。
- 通行密钥认证和注册要求设备完成用户验证（生物识别或 PIN）。设备不支持时仍可用管理密码登录。
- 修改配置后先执行 `nginx -t`，再重载 nginx 和重启网关。发布 Release 不会自动修改服务器配置。

## 本地验证

在仓库根目录运行：

```bash
npm ci --prefix auth-gateway --ignore-scripts
node --check auth-gateway/server.mjs
node scripts/check-gateway.mjs
node scripts/check-release.mjs
```

检查脚本仅监听本机临时端口，使用临时随机凭据，不连接真实后端。硬件通行密钥仍需在实际 HTTPS 站点验收。


每次发布的 Release 里都有 `auth-gateway.zip`，内容就是这个目录。
