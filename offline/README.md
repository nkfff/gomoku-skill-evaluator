# 猫猫棋局 · Hybrid Edition

> **目标：一个真正安装在设备上的 App，同时支持联网和离线。** 游戏界面、AI、模型、棋谱与本地数据随安装包内置；联网时调用现有 Supabase / Cloudflare 服务，断网时保留单机能力。它不是把网页地址放进壳里，也不要求玩家通过浏览器打开游戏。

## Hybrid 运行模式

| 能力 | 联网 | 离线 |
|---|---|---|
| 标准 AI 对弈、Gunuce 本地模型 | 本地运行 | 本地运行 |
| 残局挑战、随机连珠 | 本地生成/运行；登录后可走云端验证与奖励 | 本地生成与本地奖励 |
| 逐手复盘、关键转折、训练建议 | 可用 | 可用 |
| 在线 AI 棋局教练 | 登录后调用 Cloudflare Workers AI | 不可用；保留本地复盘 |
| Supabase 账号登录、云端积分与排行榜 | 可用 | 暂不可用，恢复网络后重新连接 |
| 好友 PVP、观战、悔棋/和棋申请、真人 Elo | 可用，需登录 | 不可用；保留本地房间会话并尝试重连，超过服务端断线宽限期可能结束对局 |
| 终局成绩同步 | 直接提交 | 先进入本地待同步队列，联网后重试 |

**核心原则：** 网络不是开始一局游戏的前置条件。AI 推理、棋盘交互和本地复盘不依赖服务器；PVP 和在线 AI 教练则明确要求联网。

## 当前原生架构

- **Android / iOS：** Capacitor 8，游戏资源和 ONNX 模型打包进 App。App 使用 https://localhost（Android）和 capacitor://localhost（iOS）安全源。
- **macOS / Windows / Linux：** Electron，使用 gomoku://app 安全源加载本地文件、Worker 和 WASM。
- **账号：** 复用当前 Supabase Auth，不创建第二套用户系统。
- **AI / 积分：** 复用 V4.0 V2 Worker、D1 数据库和 Workers AI。
- **好友对战：** 复用 V4.0 V3 Worker、Durable Objects 和现有 PVP 房间生命周期。
- **断网缓存：** 原生 App 直接读取包内资源；PWA 首次下载完成后使用 Service Worker 缓存。

## 原生联网配置

V2 与 V3 Worker 的 APP_ORIGINS 允许以下固定 Origin：

- capacitor://localhost：iOS Capacitor
- https://localhost：Android Capacitor
- gomoku://app：Electron 桌面 App

CORS 只决定请求能否从这些 App Origin 到达 Worker；每个账号接口仍由服务端校验 Supabase JWT，PVP 的房间、落子、观战与 Elo 仍由 Worker / Durable Object 权威处理。不要把 service-role、Cloudflare API Token 或任何服务端密钥放进客户端。

Supabase 邮箱验证和密码找回使用现有 GitHub Pages V4 回调地址：

https://nkfff.github.io/gomoku-skill-evaluator/v4.0/

若 Supabase Auth 的 Redirect URL allowlist 启用了严格模式，确保包含该 URL。用户完成邮箱验证后，打开 App 使用邮箱密码登录。登录 SDK 在网络可用时加载；如果 App 冷启动时没有网络，会自动保持游客单机模式，并在网络恢复后重试初始化。

## AI 复盘入口

- 对局操作区的「AI 复盘」按钮进入复盘面板。
- 手机底部导航保留「复盘」入口，不再隐藏。
- 复盘面板始终显示本地棋形分析、关键转折与训练建议。
- 「在线 AI 解读当前局面」按钮保留显示；未登录、离线或额度用尽时会明确说明原因，不会把本地复盘一起禁用。
- 在线讲解按 V4.0 规则计入每日免费额度；讲解结果在当前棋局/棋步缓存。

## Hybrid 颜色与可读性\n\n- 原生 App 外壳固定使用高对比浅色语义色；棋盘和棋子皮肤只改变棋盘/棋子外观，不再把夜间主题的浅色文字变量带入浅色面板。\n- 正文、次要说明、统计标签、导航选中态、主按钮、输入框、AI 复盘、PVP 状态及禁用控件统一使用可读的前景色。\n- CI 对 6 种棋盘皮肤与 6 种棋子皮肤的 36 种组合检查关键文本 WCAG AA 对比度（至少 4.5:1）。\n\n## 手机导航与 UI

手机底部五个主入口：**对弈、复盘、挑战、好友、我的**。随机连珠从「挑战」页面进入；在线排行榜和皮肤收藏从「我的」页面进入。桌面仍保留完整导航。布局回归覆盖 320 / 390 / 768 px、44 px 触控目标和 safe-area。

## 本地构建

需要 Node.js >=22、Python >=3.10。macOS 图标生成需先执行 brew install cairo。

    python3 -m pip install -r offline/requirements.txt
    node offline/build.mjs
    node --test offline/tests/*.test.mjs

本地浏览器测试：

    python3 -m http.server 8043 --bind 127.0.0.1

打开 http://127.0.0.1:8043/offline/dist/。不要用 file:// 双击 HTML 测试模块 Worker / Service Worker。

Android / iOS 原生工程：

    cd offline
    npm install
    npm run native:android
    npm run native:ios

## 发布附件与签名边界

- Android 当前为 Debug APK，适合测试安装，不是 Play Store 正式签名包。
- iOS 当前公开附件仍是 Simulator ZIP，不是 iPhone 可安装 IPA。真机 Ad Hoc IPA 需要 Apple Distribution 证书、已登记设备 UDID 的描述文件与 Team ID；所有 iPhone 用户分发应使用 TestFlight / App Store。
- macOS Apple Silicon arm64 与 Intel x64 DMG 已通过 CodeResources、签名结构及架构验证；当前 ad-hoc 签名未经过 Apple Developer ID 公证，Gatekeeper 仍可能提示风险。免提示发行需要 Developer ID + Apple Notarization。
- Windows / Linux 当前为测试安装包，正式签名与实体设备验收仍待完成。

**beta.2**：https://github.com/nkfff/gomoku-skill-evaluator/releases/tag/offline-v0.1.0-beta.2  
**beta.3（已发布）**：Hybrid 联网/离线 App，包含账号、好友 PVP、AI 复盘入口与五项移动导航：https://github.com/nkfff/gomoku-skill-evaluator/releases/tag/offline-v0.1.0-beta.3

## 正式发布门槛

- [x] 游戏资源、AI 与模型内置，断网可启动
- [x] 在线账号、AI 教练、好友 PVP 与原有服务端复用
- [x] Capacitor / Electron 原生 Origin 的 Worker CORS 白名单
- [x] 离线冷启动、网络恢复后的账号初始化重试
- [x] PVP 离线暂停轮询、恢复网络后尝试重连（仍遵守服务端断线宽限期）
- [x] 手机复盘与好友入口可见
- [ ] Android / iPhone 实体设备上的账号注册、登录、邮箱验证及 PVP 联调
- [ ] iPhone Ad Hoc / TestFlight 签名分发
- [ ] macOS Developer ID 公证
- [ ] Windows / Linux 签名与实体设备安装验收
- [ ] 后台恢复、弱网、断线重连、低内存和升级测试矩阵

