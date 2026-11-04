# 猫猫棋局 · 全平台离线版（开发预览）

> 本目录是独立于在线 V4 的单机发行工程。**尚未发布 APK、IPA、桌面安装包或正式 Release。** 不修改在线 Pages、PVP、Supabase、Cloudflare 的服务配置。

## 支持范围与当前边界

- Web/PWA：AI 三档、Gunuce 本地 ONNX+WASM/WebGPU、残局、随机连珠、复盘、皮肤与本地积分，均复用 V4 引擎。
- Android/iOS：采用 Capacitor 8，将静态资源随 App 内置，首次启动不需要网络。当前仅有项目生成和打包脚本，**仍需真实设备验证**。
- macOS/Windows/Linux：下一阶段做独立打包，当前尚无桌面安装包。
- 不提供在线登录、PVP、观战、云端积分或服务器排行榜。本地积分独立；卸载或清理数据可能丢失。
- PWA 第一次打开需联网下载包括 Gunuce 模型与 WASM 的离线资源，直到显示“可断网使用”。原生 Android/iOS 将资源打入安装包。

## 本地 PWA 构建

需要 Node.js >=22、Python >=3.10。安装图标渲染依赖并构建：

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

## 尚未满足的正式发布门槛

- [x] 独立构建、离线云功能隔离、复用本地四类玩法
- [x] PWA manifest、可爱猫猫矢量图与可生成图标
- [x] Mobile-first 布局与离线导航
- [x] Capacitor Android / iOS 配置及工程生成命令
- [ ] CI 浏览器功能、离线启动和横向溢出测试通过
- [ ] 至少两台 Android 真机及两台不同屏幕的 iPhone 完成验证
- [ ] WKWebView / Web Worker / WASM、后台恢复、冷启动和低内存压力测试
- [ ] 签名 APK/AAB/IPA 与自动化发布
- [ ] macOS、Windows、Linux 安装包

重点原则：**未完成真机验收，不宣称 Android/iOS 应用已正式发布。**

## macOS / Windows / Linux 桌面版

独立 Electron 安装包构建已在 `offline/desktop/` 中提供。使用 `gomoku://app` 安全源加载本地 Worker 与 WASM，复用 Android/iOS 同一套单机逻辑。参见 [desktop/README.md](desktop/README.md)。当前未签名，正式 Release 前仍需 CI 和目标机器验收。
