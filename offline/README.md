# 猫猫棋局 · Offline Edition

> 本目录是独立于在线 V4 的单机发行工程。**[offline-v0.1.0-beta.2 已发布 GitHub Beta 预发布版](https://github.com/nkfff/gomoku-skill-evaluator/releases/tag/offline-v0.1.0-beta.2)**，含六个平台的下载附件。维护者已确认本次 Beta 验收通过。在线 Pages、PVP、Supabase、Cloudflare 的服务逻辑保持独立。

## macOS DMG 修复和 Intel 适配（beta.2）

旧版 DMG 曾出现 `codesign --verify --deep --strict` 报错 `code has no resources but signature indicates they must be present`，说明应用签名资源封装不完整。当前开发分支增加 Electron `afterSign` 修复与 CI 检查：DMG 挂载、`Contents/_CodeSignature/CodeResources`、`codesign` 完整校验、`lipo` 架构验证。

macOS 现在提供两个独立 DMG 构建：Apple Silicon arm64 和 Intel x86_64。未配置 Developer ID 的公开 Beta 会使用 ad-hoc 签名；这能修复签名封装错误，**但仍不是 Apple Developer ID 签名/公证**。为避免 Gatekeeper 弹出其他阻止提示，维护者可在仓库 Actions 手动执行 [Offline macOS Developer ID signed and notarized DMG](../.github/workflows/offline-macos-notarized.yml)，需要将 `MAC_CSC_LINK`（Developer ID Application P12 的 base64）、`MAC_CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 配置为 GitHub Actions Secrets。签名与公证通过后可选择把经过 Gatekeeper 验证的 DMG 附加到 Release。

## iPhone 真机版（beta.2）

新增 [iPhone 设备构建与 Ad Hoc 签名](ios-sign/README.md)。CI 可自动验证 iOS arm64 真机目标；真正可安装的 `.ipa` 只有在 Apple Developer Distribution 证书、密码、Ad Hoc Profile、Team ID 均被配置为 GitHub Secrets 后才能导出。**Ad Hoc IPA 只可安装到描述文件中预先登记 UDID 的 iPhone**；对所有玩家分发仍需 TestFlight/App Store。没有凭据时不得把模拟器 ZIP 声称为 iPhone 可安装版。

## 支持范围与当前边界

- Web/PWA：AI 三档、Gunuce 本地 ONNX+WASM/WebGPU、残局、随机连珠、复盘、皮肤与本地积分，均复用 V4 引擎。
- Android/iOS：采用 Capacitor 8，将静态资源随 App 内置，首次启动不需要网络。已完成原生 CI 编译。**当前公开 iOS 附件仅为 Simulator 应用，并非可供普通 iPhone 安装的签名 IPA**。
- macOS/Windows/Linux：Electron 的独立打包流程已接入，CI 已构建并上传未签名安装包，当前同时提供 Apple Silicon arm64 和 Intel x64 DMG，均已通过完整 CodeResources 资源签名与架构验证；尚未经过 Apple Developer ID 公证。
- 不提供在线登录、PVP、观战、云端积分或服务器排行榜。本地积分独立；卸载或清理数据可能丢失。
- PWA 第一次打开需联网下载包括 Gunuce 模型与 WASM 的离线资源，直到显示“可断网使用”。原生 Android/iOS 将资源打入安装包。

## 本地 PWA 构建

需要 Node.js >=22、Python >=3.10。安装图标渲染依赖并构建（macOS 需先执行 `brew install cairo`）：

```bash
python3 -m pip install -r offline/requirements.txt
node offline/build.mjs
python3 -m http.server 8043 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8043/offline/dist/`；不要用 `file://` 双击 HTML 测试模块 Worker / Service Worker。
静态验证：`node --test offline/tests/*.test.mjs`。

手机 UI 优先适配 320/390/768px、44px 触控目标与 safe-area；底部导航为对弈、挑战、装扮、我的。随机连珠从挑战页面进入，复盘从对弈页面进入。
统一图标源文件 `icons/cat-gomoku.svg`，构建生成 PWA 192/512 与原生 1024 PNG。

## Android / iOS 原生工程

```bash
cd offline
npm install
npm run native:android  # 需要 Android SDK
npm run native:ios      # 需要 macOS + Xcode
```

脚本先构建离线 Web，然后执行 `cap add` / `cap sync` 和 `capacitor-assets generate`。Android 可在 `offline/android` 目录运行 `./gradlew assembleDebug` 获取用于测试安装的 APK。iOS 需 Xcode 真机签名，TestFlight/App Store 需要 Apple Developer 账号。
Capacitor 依赖固定在 8.6.0；生成目录暂不纳入 Git，避免改动在线版。正式发布前需要锁定 native 依赖、签名包、真实设备兼容性测试与升级测试。

## GitHub Release 下载与发布流程

**当前 Beta Release：** [offline-v0.1.0-beta.2](https://github.com/nkfff/gomoku-skill-evaluator/releases/tag/offline-v0.1.0-beta.2)，包含 Android Debug APK、iOS Simulator ZIP、macOS arm64 DMG、**macOS Intel x64 DMG**、Windows x64 EXE、Linux x86_64 AppImage、Web/PWA ZIP。永久附件链接见仓库首页 [README](../README.md#离线多端版--offline-edition)。

自动发布工作流为 [Offline Beta Release](../.github/workflows/offline-release.yml)。在未来发布新版本时，修改版本号并推送新 `offline-v*` 标签，或使用 GitHub Actions 的 `workflow_dispatch` 指定新标签；所有平台构建成功才创建新的 Pre-release。**不要重复发布已有标签，避免覆盖已经分发的安装包。**

用户已确认本次 Beta 验收通过；但 GitHub Beta 发行不等于 Google Play、TestFlight 或 App Store 上架。面向这些商店时仍需要 Android 正式签名/AAB、Apple Developer 证书和签名 IPA、应用审核以及必要的机型兼容记录。

## 尚未满足的正式发布门槛

- [x] 独立构建、离线云功能隔离、复用本地四类玩法
- [x] PWA manifest、可爱猫猫矢量图与可生成图标
- [x] Mobile-first 布局与离线导航
- [x] Capacitor Android / iOS 配置及工程生成命令
- [x] CI 浏览器功能、离线启动和横向溢出测试通过
- [x] 维护者已确认 Beta 验收通过
- [ ] 补齐公开可追溯的 Android/iPhone 设备与系统版本测试矩阵
- [ ] WKWebView / Web Worker / WASM、后台恢复、冷启动和低内存压力测试
- [x] GitHub Release 自动化构建与上传工作流
- [ ] 签名 APK/AAB/IPA 与正式商店发布
- [x] macOS、Windows、Linux 未签名安装包构建成功
- [ ] 三套桌面安装包的实体设备安装与稳定性验证

重点原则：**未完成真机验收，不宣称 Android/iOS 应用已正式发布。**

## macOS / Windows / Linux 桌面版

独立 Electron 安装包构建已在 `offline/desktop/` 中提供。使用 `gomoku://app` 安全源加载本地 Worker 与 WASM，复用 Android/iOS 同一套单机逻辑。参见 [desktop/README.md](desktop/README.md)。当前为未签名 Beta 预发布，CI 构建已经成功；正式签名及广泛兼容性支持尚待完善。

**版本命名**：离线版从 `offline-v0.1.0-beta.1` 起步，目前发行 `offline-v0.1.0-beta.2`；线上版本继续为 V4.0.x，训练研究分支 V4.1.x 保持独立。已在 GitHub 发布 Beta，安装包仍为测试版本。
