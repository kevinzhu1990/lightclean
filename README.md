# 轻净 LightClean

轻净（LightClean）是一款面向 Windows、macOS 和 Linux 的开源电脑清理与隐私工具，提供系统垃圾清理、安全检查、软件管理，以及安全的微信聊天数据清理功能。

> 本项目基于 [Kudu](https://github.com/adventdevinc/kudu) 二次开发，遵循 MIT License。原项目版权和许可证信息保留在 [LICENSE](LICENSE) 中。

## 核心功能

- 系统、浏览器、应用缓存和临时文件清理
- 安全清理分级：推荐清理、需要确认、不要自动清理，默认只选择推荐项
- 每项清理均说明可删除原因、影响和恢复方式；普通清理默认进入回收站
- 磁盘清理：扫描临时文件、缓存、日志、缩略图和回收站，确认后再清理
- 独立回收站管理：显示项目数量和占用空间，二次确认后永久清空
- 磁盘分析、重复文件和大文件查找
- 重复文件只读参考目录：照片原库、备份盘、工作目录只参与比对，绝不删除
- 启动项、软件、驱动与系统服务管理
- 卸载闭环：安装大小、最近使用、安装日期、发行商、预计残留和逐项批量结果
- 已签名规则包：版本、变更说明、完整性校验、回滚和用户自定义排除项
- 隐私、安全加固和恶意软件扫描
- Windows 与 macOS 微信聊天数据扫描和选择性清理
- 电脑配置页面：查看系统、处理器、显卡、内存、硬盘、显示器和网络设备

## 微信清理的安全设计

- 只扫描微信标准目录或用户手动选择的微信目录
- 删除前展示账号、数据类型、路径、修改日期和占用空间
- 扫描后默认不勾选任何项目
- 检测到微信正在运行时拒绝清理
- 只接受当前扫描产生的项目编号，界面不能提交任意路径
- 删除操作进入 Windows 回收站或 macOS 废纸篓
- 跳过符号链接，并再次验证目标位于已扫描目录内

详细说明见 [WECHAT_CLEANER.md](WECHAT_CLEANER.md)。重要聊天记录请先使用微信官方备份功能备份。

## 本地开发

需要 Node.js 20 或更高版本。

```bash
npm ci
npm test
npm run dev
```

## 打包

Windows 安装包必须在 Windows 上构建：

```bash
npm run package:win
```

macOS 安装包必须在 Mac 上构建：

```bash
npm run package:mac
```

默认同时生成 Intel（x64）和 Apple Silicon（arm64）的 DMG/ZIP。未配置 Apple Developer 证书时可以完成本地测试构建，但对外正式分发前应完成代码签名与 Apple 公证。

## 上传到 GitHub

Mac 上的完整操作见 [MACOS_GITHUB_UPLOAD.md](MACOS_GITHUB_UPLOAD.md)。

## 开源署名

- 上游项目：[adventdevinc/kudu](https://github.com/adventdevinc/kudu)
- 上游作者：Kudu Contributors
- 二次开发名称：轻净 LightClean
- 许可证：MIT
