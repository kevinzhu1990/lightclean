# 轻净兑换码服务

该服务为轻净提供30天试用、兑换码、单设备绑定、到期验证和设备解绑。

## 本地启动

```powershell
npm install
$env:LIGHTCLEAN_LICENSE_ADMIN_TOKEN='请替换为随机长密码'
npm start
```

默认监听 `3210` 端口，数据库位于 `license-server/data/licenses.db`。

## 生成兑换码

```powershell
npm run codes -- quarter 10
npm run codes -- half_year 10
npm run codes -- annual 10
npm run codes -- lifetime 10
```

生成结果只显示一次。数据库仅保存兑换码哈希，必须将原始兑换码保存到安全的订单管理系统。

## 正式部署

- 必须使用HTTPS。
- 设置 `LIGHTCLEAN_LICENSE_DB` 到持久化磁盘。
- 设置高强度 `LIGHTCLEAN_LICENSE_ADMIN_TOKEN`，不要提交到GitHub。
- 用反向代理限制请求频率并保存错误日志。
- 将公网地址写入 `resources/license-config.json` 的 `apiUrl` 后重新构建客户端。
