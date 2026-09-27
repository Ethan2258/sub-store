# 登录网关

给 Sub-Store 加一道登录页，界面和前端一样是黑白灰液态玻璃。支持管理密码和通行密钥（Passkey），1Password、iCloud 钥匙串等密码管理器可以直接填充。

- 没登录时 nginx 把请求交给网关检查，未通过就跳到 `/_auth/login`。
- 密码登录不刷新页面；错了就地提示，并选中密码方便重输。
- 添加过通行密钥后，点用户名或密码框时密码管理器会直接给出通行密钥；页面放久了也会自动换新的验证请求，不会出现「验证请求已过期」。
- 登录后访问 `/_auth/settings` 可以添加通行密钥或退出登录。
- 连续输错 5 次密码，这个 IP 会被锁 30 分钟。

## 运行

需要 Node.js 20 以上。

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
| `PORT` | 可选，默认 `3102`，只监听 `127.0.0.1` |

生成密码哈希和会话密钥：

```bash
node -e 'const c=require("crypto"),p=process.argv[1],s=c.randomBytes(16);console.log("PASSWORD_SALT="+s.toString("base64url")+"\nPASSWORD_HASH="+c.scryptSync(p,s,32).toString("base64url")+"\nSESSION_SECRET="+c.randomBytes(32).toString("base64url"))' '你的管理密码'
```

nginx 里用 `auth_request` 指向网关的 `/check`，并把 `/_auth/` 反代到网关根路径。

每次发布的 Release 里都有 `auth-gateway.zip`，内容就是这个目录（不含测试）。

## 测试

```bash
npm ci --omit=dev
npm test
```

测试会用临时密码在随机端口上启动网关，检查密码登录、`/check` 会话校验、会话绑定 IP、篡改的 Cookie 会被拒绝，以及连续输错 5 次后锁定。每次构建都会跑，失败就不发布。Dependabot 每月检查一次网关依赖的更新。
