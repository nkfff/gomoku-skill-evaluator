# 猫猫棋局 · 全平台离线版（开发预览）

> 本目录是独立于在线 V4 的单机发行工程。**CI 已生成 Android 调试 APK、iOS 模拟器应用与未签名桌面安装包；尚未创建正式 Release。** 不修改在线 Pages、PVP、Supabase、Cloudflare 的服务配置。

## 支持范围与当前边界

- Web/PWA：AI 三档、Gunuce 本地 ONNX+WASM/WebGPU、残局、随机连珠、复盘、皮肤与本地积分，均复用 V4 引擎。
- Android/iOS：采用 Capacitor 8，将静态资源随 App 内置，首次启动不需要网络。已完成原生 CI 编译；**仍需真实设备验证**。
- macOS/Windows/Linux：Electron 的独立打包流程已接入，CI 可生成未签名安装包，仍需目标设备验收。
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

## GitHub Release 发布流程

正式发布工作流位于 `.github/workflows/offline-release.yml`。它监听 `offline-v*` 标签；标签推送后会重新构建 PWA、Android Debug APK、iOS Simulator 包、macOS DMG、Windows EXE 与 Linux AppImage，待全部构建成功后自动创建 GitHub **预发布版（Pre-release）** 并上传附件。

建议在 Android/iPhone 真机验收完成、PR 合并到 `main` 后，再创建并推送版本标签：

```bash
git checkout main
git pull --ff-only
git tag offline-v0.1.0-beta.1
git push origin offline-v0.1.0-beta.1
```

工作流成功后，下载入口为 [GitHub Releases](https://github.com/nkfff/gomoku-skill-evaluator/releases)。当前尚未推送发布标签，因此**目前没有正式 GitHub Release**；README 首页列出的链接是暂时的 Actions 测试产物，不是永久下载链接。

## 尚未满足的正式发布门槛

- [x] 独立构建、离线云功能隔离、复用本地四类玩法
- [x] PWA manifest、可爱猫猫矢量图与可生成图标
- [x] Mobile-first 布局与离线导航
- [x] Capacitor Android / iOS 配置及工程生成命令
- [x] CI 浏览器功能、离线启动和横向溢出测试通过
- [ ] 至少两台 Android 真机及两台不同屏幕的 iPhone 完成验证
- [ ] WKWebView / Web Worker / WASM、后台恢复、冷启动和低内存压力测试
- [x] GitHub Release 自动化构建与上传工作流
- [ ] 签名 APK/AAB/IPA 与正式商店发布
- [x] macOS、Windows、Linux 未签名安装包构建成功
- [ ] 三套桌面安装包的实体设备安装与稳定性验证

重点原则：**未完成真机验收，不宣称 Android/iOS 应用已正式发布。**

## macOS / Windows / Linux 桌面版

独立 Electron 安装包构建已在 `offline/desktop/` 中提供。使用 `gomoku://app` 安全源加载本地 Worker 与 WASM，复用 Android/iOS 同一套单机逻辑。参见 [desktop/README.md](desktop/README.md)。当前未签名，CI 构建已经成功，正式 Release 前仍需目标机器验收。

**版本命名**：离线版独立从 `offline-v0.1.0-beta.1` 起步；线上版本继续为 V4.0.x，训练研究分支 V4.1.x 保持独立。原生安装包仍为测试版。
