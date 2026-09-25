# 轻净在线授权服务

这是轻净“一张兑换码直接激活”的 Cloudflare Worker。客户首次激活时，兑换码会绑定当前电脑；同一兑换码不能在其他电脑重复使用。

## 安全边界

- D1 只保存兑换码 SHA-256 摘要，不保存原始兑换码。
- Ed25519 私钥只放在 Cloudflare Secret 中，绝不能提交到 GitHub。
- 客户端只包含公钥，用于验证云端签发的短期离线凭证。
- 飞书 App Secret 只放在 Cloudflare Secret 中。
- 客户端无法自行解除设备绑定；换机只由已登录 Cloudflare 的卖家人工批准。

## 部署步骤

1. 安装依赖：`npm install`
2. 登录：`npx wrangler login`
3. 创建 D1：`npm run db:create`
4. 把返回的 `database_id` 写入 `wrangler.toml`
5. 初始化：`npm run db:migrate`
6. 设置私钥：`npx wrangler secret put LICENSE_PRIVATE_KEY`
7. 部署：`npm run deploy`

飞书同步为可选项，需要设置 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_SPREADSHEET_TOKEN` 和 `FEISHU_SHEET_ID`。

## 审核换机

1. 先将本目录的新版 Worker 部署到 Cloudflare。只上传 GitHub 不会改变线上规则；旧 Worker 仍允许客户自行解绑。
2. 客户在**新电脑**的“授权与套餐”页复制设备申请码，并提供订单号和原兑换码。卖家核对订单、兑换码归属和原设备尾号；不能只凭持有码批准换机。
3. 在本目录运行 `npm ci`、`npx wrangler login`，然后运行 `npm run transfer:approve`。按提示输入兑换码、新设备申请码，并核对查出的套餐、旧设备尾号、到期时间；最后输入工具显示的确认短语。
4. 工具会直接把数据库绑定改为已审核的新设备，不会先把兑换码置为未绑定。客户随后在新电脑输入**原兑换码**即可激活。换机不重置套餐到期时间。

审核工具只提交兑换码的 SHA-256 摘要和新设备标识给 D1，不在命令参数或仓库中保存原兑换码。旧设备已取得的离线凭证在剩余有效期内仍可能使用，最长 14 天；公开客户端不能提供绝对防破解保证。
