# 在 Mac 上构建并上传轻净 LightClean

这份源码已经按目标仓库 `kevinzhu1990/lightclean` 配置。把源码压缩包复制到 Mac 并解压后，按下面步骤操作。

## 1. 安装工具

打开 Mac 的“终端”，先安装 Homebrew（如果已经安装可跳过），再执行：

```bash
brew install node git gh
node --version
npm --version
git --version
gh --version
```

建议使用 Node.js 20 或更高版本。

## 2. 验证源码并打包 macOS 版本

在终端中进入解压后的 `LightClean` 源码目录：

```bash
cd 你的LightClean源码目录
npm ci
npm test
npm run package:mac
```

完成后，安装包会出现在 `dist` 目录，包括 Intel（x64）和 Apple Silicon（arm64）版本。

## 3. 登录 GitHub

```bash
gh auth login
```

依次选择：

1. `GitHub.com`
2. `HTTPS`
3. `Login with a web browser`

浏览器显示授权成功后回到终端。

## 4. 创建仓库并上传源码

```bash
git init
git branch -M main
git add .
git commit -m "feat: release LightClean 1.2.3"
gh repo create lightclean --public --source=. --remote=origin --push
```

如果 GitHub 上已经提前创建了 `lightclean` 仓库，则改用：

```bash
git remote add origin https://github.com/kevinzhu1990/lightclean.git
git push -u origin main
```

## 5. 发布安装包（可选）

```bash
gh release create v1.2.3 dist/LightClean-1.2.3-*.dmg dist/LightClean-1.2.3-*.zip --title "轻净 LightClean 1.2.3" --notes "修复打包缓存错误提示，软件界面、托盘和安装信息统一使用轻净 LightClean 品牌。"
```

## macOS 正式发布提醒

- 自己测试可使用未签名构建。
- 给其他用户公开下载时，建议准备 Apple Developer 账号并配置签名与公证。
- 第一次打开未签名版本时，可能需要在“系统设置 → 隐私与安全性”中允许打开。
- 不要上传 `node_modules`、`out`、`dist` 或个人配置；项目的 `.gitignore` 已排除这些目录。
