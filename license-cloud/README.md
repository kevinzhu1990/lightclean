# 轻净在线授权服务

这是轻净“一张兑换码直接激活”的 Cloudflare Worker。客户首次激活时，兑换码会绑定当前电脑；同一兑换码不能在其他电脑重复使用。

## 安全边界

- D1 只保存兑换码 SHA-256 摘要，不保存原始兑换码。
- Ed25519 私钥只放在 Cloudflare Secret 中，绝不能提交到 GitHub。
- 客户端只包含公钥，用于验证云端签发的短期离线凭证。
- 飞书 App Secret 只放在 Cloudflare Secret 中。

## 部署步骤

1. 安装依赖：`npm install`
2. 登录：`npx wrangler login`
3. 创建 D1：`npm run db:create`
4. 把返回的 `database_id` 写入 `wrangler.toml`
5. 初始化：`npm run db:migrate`
6. 设置私钥：`npx wrangler secret put LICENSE_PRIVATE_KEY`
7. 部署：`npm run deploy`

飞书同步为可选项，需要设置 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_SPREADSHEET_TOKEN` 和 `FEISHU_SHEET_ID`。
