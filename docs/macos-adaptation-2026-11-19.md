# macOS 窗口适配检查（2026-11-19）

## 本次修复

- 根因：所有系统统一使用 `frame: false`，并无条件显示右上角 HTML 窗口控制按钮。
- Mac 改为原生隐藏标题栏，左上角使用系统红黄绿按钮；侧栏 Logo 上方预留 40px，不遮挡原生按钮。
- Mac 不再显示 Windows 风格的右上角按钮。Windows/Linux 原有布局不变。
- 通过预加载桥接同步提供平台身份，不等待平台查询，避免首屏按钮闪烁。
- 添加 Mac 原生关闭窗口、最小化、缩放/全屏、窗口菜单角色；保留复制、粘贴、撤销等编辑角色。
- Dock 激活与第二次启动统一先恢复已最小化的窗口，再显示、聚焦；保留现有关闭后继续运行及显式退出策略。
- 键盘聚焦“跳到主要内容”时，Mac 专属将提示下移到 40px 并排除拖动区域，避免被原生按钮覆盖。独立窗口验证先复现旧位置 8px 失败，再修复至 40px 通过。

## 其他适配检查

| 项目 | 检查结论 | 验证边界 |
| --- | --- | --- |
| 深色/浅色跟随系统 | 已有 `prefers-color-scheme` 监听 | 本次未改变主题 |
| Mac 缓存及垃圾箱路径 | 已有 `rules/darwin` 及专用平台模块 | 仅查代码，不扫描、清理真实文件 |
| Finder/废纸篓 | 删除默认使用 Electron `shell.trashItem` | 不触发实际删除 |
| 完全磁盘访问权限 | 已有扫描不完整告警及中文权限指引 | 未申请或改变用户权限 |
| 登录项 | 已有 macOS 专用实现及测试 | 不修改实际登录项 |
| 软件更新 | 已分别探测 Apple Silicon `/opt/homebrew/bin/brew` 与 Intel `/usr/local/bin/brew` | 不安装或升级第三方软件 |
| Windows 专用页面 | 平台能力控制注册表、驱动等入口 | 原有适配保留 |
| 打包 | 已有 arm64/x64 DMG 与 ZIP 配置、AppleEvents 用途说明 | 本次仅生成 arm64 本地测试包，不发布 |

后续优化：后台初始化仍会在 Mac 请求 Windows 驱动/游戏模式状态，可按平台能力跳过无效请求。此问题不影响本次原生按钮修复，留作独立改动，避免扩大窗口修复范围。

## 验证记录

- 基线：120 个测试文件通过；2318 项通过、3 项跳过。
- 新回归测试先观察到 6 项预期行为失败，再修复至全部通过。
- 修复后：122 个测试文件通过；2331 项通过、3 项跳过。
- `npm run build` 通过。
- 仓库整体类型检查仍有 221 条既有错误；与原始 main 的结果逐项对比完全一致，本次修改文件无新增错误。未擅自修复授权云服务、其他测试和 YARA 类型问题。
- 独立 Electron 原生窗口测试通过：同步平台为 darwin、HTML 控件数量为 0、侧栏 Logo 顶部约 61px、最小化/恢复、全屏往返、关闭窗口。
- 原生窗口截图验证左上角真实红黄绿按钮；渲染器无 console error。
- 独立测试使用临时 user-data 和只返回示例结果的 IPC；不启动清理服务、不修改登录项、不改变已安装轻净及其授权/设置。
- Native menu roles 已通过模板测试；未注入真实键盘事件验证每一个系统快捷键。
- 独立审查后保留两项验证限制：首次引导仅静态核对居中布局；截图命令失败尚不自动使脚本失败，引用截图时需确认本轮退出状态与时间戳。本轮截图命令实际返回 0，已检查图片。

## 本地复现

使用 Node 22 或 24：

```sh
npm ci
npm test
npm run build
npx esbuild scripts/check-macos-window.ts --bundle --platform=node --external:electron --outfile=.superpowers/macos-window-check.cjs
node_modules/.bin/electron .superpowers/macos-window-check.cjs
```

窗口配置与恢复：`src/main/services/window-chrome.ts`；界面：`src/renderer/src/components/layout/`；独立验证入口：`scripts/check-macos-window.ts`。验证截图及报告位于 `.superpowers/macos-window-proof/`，该目录仅为本地证据，不提交到远端。

本次为基于 1.4.3 的本地修复，未提升正式版本号、未推送、未创建 PR、未发布 GitHub Release、未替换 `/Applications` 中的应用。安装正式更新需要独立确认，并保留旧应用以便回滚。

## 本地测试包边界

常规 DMG 打包的辅助工具下载遇到 TLS 断连，已完成的应用本体没有受损。随后使用本地 `hdiutil` 生成 Apple Silicon arm64 测试 DMG，不需要重装依赖或变更系统设置。

本地包只用 ad-hoc 签名，未获得 Apple Developer ID 公证。仅本次打包命令覆盖 `mac.hardenedRuntime=false`，避免 ad-hoc 测试包的原生数据库库验证失败；源码正式打包配置仍保持 hardenedRuntime 开启。不要把该测试包当成公开发行版或宣称自动更新已验收。

应用本体通过 `codesign --verify --deep --strict`；打包后的 Electron 实际加载 SQLite 原生模块并完成内存库查询；ASAR 中 main、preload 和 renderer 的 SHA-256 与最终构建逐项一致。
