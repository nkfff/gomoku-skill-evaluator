# 五子棋棋力评估 · Gomoku Skill Evaluator

> 一个集 AI 对弈、棋力评估、残局训练、随机连珠与好友真人 PVP 于一体的浏览器五子棋项目。

**当前稳定版本：** [V4.0.11](https://nkfff.github.io/gomoku-skill-evaluator/v4.0/)  
**离线单机版（Beta）：** [GitHub Release · Android / iOS 模拟器 / macOS / Windows / Linux / PWA](https://github.com/nkfff/gomoku-skill-evaluator/releases/tag/offline-v0.1.0-beta.1)  
**项目档案：** [完整开发规划与历史记录](docs/DEVELOPMENT_ROADMAP.md)

## V4.0.10 · 复盘隔离与棋局 AI 教练（2026-11-04）

- 修复复盘报告泄漏至残局、随机、好友对战、排行榜、皮肤馆和个人中心的显示错误；补强 hidden 样式优先级及切换检查。
- 在线 AI 从跳转搜索引擎改为针对当前棋谱及所选步数进行 Cloudflare Workers AI 中文讲解；先本地校验棋谱与基础战术，再由模型解释。
- 免费层保护：登录后主动点击、每位用户每天最多 8 次、全站每天最多 120 次；超时、离线或配额不足自动保留离线复盘，不上传完整账户资料。
- 新增在线棋局分析接口、云端每日限额迁移与回归测试；原有积分、PVP 逻辑保持不变。

## 项目功能

- **AI 对弈与棋力评估：** 多档 AI、逐手棋谱、复盘与落子质量分析。
- **训练模式：** 多步残局挑战、3–10 连珠随机模式。
- **好友竞技：** 邀请码房间、实时对战、悔棋/和棋弹窗确认、认输、Elo 排名与连续对局。
- **账号与成长：** 云端账号、积分、排行榜、棋盘和棋子主题。

技术架构：前端使用 HTML/CSS/JavaScript，部署于 GitHub Pages；账号认证使用 Supabase；云端业务使用 Cloudflare Workers、D1 与 Durable Objects。

## 离线多端版 · Offline Edition

**[猫猫棋局 offline-v0.1.0-beta.1：GitHub Release 正式下载](https://github.com/nkfff/gomoku-skill-evaluator/releases/tag/offline-v0.1.0-beta.1)**

> 2026-11-04 已发布 **Beta 预发布版（Pre-release）**，本次包含 6 个长期下载附件。维护者已确认 Beta 验收通过；正式签名、App Store/TestFlight 上架与更广泛机型兼容仍需单独处理。

| 平台 | 直接下载 | 说明 |
|---|---|---|
| Android | [下载 APK](https://github.com/nkfff/gomoku-skill-evaluator/releases/download/offline-v0.1.0-beta.1/Gomoku_Offline_Android_Debug_offline-v0.1.0-beta.1.apk) | Debug 测试签名，非 Google Play 正式包 |
| iOS | [下载模拟器版](https://github.com/nkfff/gomoku-skill-evaluator/releases/download/offline-v0.1.0-beta.1/Gomoku_Offline_iOS_Simulator_offline-v0.1.0-beta.1.zip) | **仅 iOS Simulator**，无法直接安装到普通 iPhone |
| macOS | [下载 DMG](https://github.com/nkfff/gomoku-skill-evaluator/releases/download/offline-v0.1.0-beta.1/cat-gomoku-offline-0.1.0-beta.1-mac-arm64.dmg) | Apple Silicon (arm64)，未签名；当前无 Intel 安装包 |
| Windows | [下载 EXE](https://github.com/nkfff/gomoku-skill-evaluator/releases/download/offline-v0.1.0-beta.1/cat-gomoku-offline-0.1.0-beta.1-win-x64.exe) | x64，未签名 |
| Linux | [下载 AppImage](https://github.com/nkfff/gomoku-skill-evaluator/releases/download/offline-v0.1.0-beta.1/cat-gomoku-offline-0.1.0-beta.1-linux-x86_64.AppImage) | x86_64 |
| Web / PWA | [下载 PWA ZIP](https://github.com/nkfff/gomoku-skill-evaluator/releases/download/offline-v0.1.0-beta.1/Gomoku_Offline_PWA_offline-v0.1.0-beta.1.zip) | 需通过 HTTPS 或本地服务器提供网页；首次缓存完成后可断网 |

离线版提供本地 AI / Gunuce 推理、残局、随机连珠、复盘和本地积分；不包含在线账号、好友 PVP 或云端排行榜。离线数据和在线账号积分相互独立。

[Release 发布说明](https://github.com/nkfff/gomoku-skill-evaluator/releases/tag/offline-v0.1.0-beta.1) · [离线版安装与开发文档](offline/README.md) · [已合并 PR #56](https://github.com/nkfff/gomoku-skill-evaluator/pull/56) · [六平台构建记录](https://github.com/nkfff/gomoku-skill-evaluator/actions/runs/41768864712)

## 版本更新记录

按发布日期倒序排列；每个版本仅保留核心变化，完整功能、技术细节和测试记录请查看对应文档。

### 2026-11-04

- **V4.0.11｜AI 流式棋局讲解与复盘双栏对齐**：关闭 GLM 默认深度思考并改为逐字流式输出，等待时间扩至 60 秒；失败自动退还次数。桌面复盘左右面板等高对齐，手机端保持单栏。
  [在线体验](https://nkfff.github.io/gomoku-skill-evaluator/v4.0/) · [版本详情](v4.0/README.md)

- **V4.0.9｜PVP 和棋确认弹窗**：提出和棋后双方实时显示弹窗；申请方可撤回，对手明确选择同意或拒绝。支持断线恢复、观战只读及原有 Elo 和棋结算。
  [在线体验](https://nkfff.github.io/gomoku-skill-evaluator/v4.0/) · [版本详情](v4.0/README.md)

- **V4.0.8｜PVP 双方确认悔棋**：任一方可申请撤回上一手，对方通过弹窗同意后服务端回退棋盘和落子记录；棋钟持续计时，申请 20 秒后自动失效。
  [在线体验](https://nkfff.github.io/gomoku-skill-evaluator/v4.0/) · [版本详情](v4.0/README.md)

- **V4.0.7｜PVP 实时观战**：通过邀请码进入只读观战；房间右上角显示在线观战名单，观战端同步棋盘、双方剩余时间和思考时间，不参与对局计算。
  [在线体验](https://nkfff.github.io/gomoku-skill-evaluator/v4.0/) · [版本详情](v4.0/README.md)

- **V4.0.6｜再战邀请通知与骰子开局同步修复**：补充再战邀请的主动状态同步和弹窗兜底；房主、好友在第一手落子前均先完成骰子揭晓，再显示棋盘。
  [在线体验](https://nkfff.github.io/gomoku-skill-evaluator/v4.0/) · [版本详情](v4.0/README.md)

- **V4.0.5｜真人对局体验与房间持久化**：修复登录恢复时序，房主与好友均可重连，房间不再因 24 小时超时自动销毁；加入再来一局接受/拒绝弹窗。
  [在线体验](https://nkfff.github.io/gomoku-skill-evaluator/v4.0/) · [版本详情](v4.0/README.md)

- **V4.0.4｜好友房间恢复与管理员后台稳定性修复**：房主与好友刷新后均可恢复原房间；修复重连时旧 WebSocket 误报断线并优化骰子结果恢复展示；修复管理员战绩/竞技积分写入、排行榜刷新及账号清空反馈，同时保留皮肤和真人 PVP/Elo 数据。
  [在线体验](https://nkfff.github.io/gomoku-skill-evaluator/v4.0/) · [版本详情](v4.0/README.md) · [管理员修复 PR #45](https://github.com/nkfff/gomoku-skill-evaluator/pull/45)

### 2026-11-03

- **V4.0.3｜真人对局反馈**：修复和棋请求的接受/拒绝交互；认输、胜利、超时等终局向双方同步结果，并增加胜者提示与动画。  
  [在线体验](https://nkfff.github.io/gomoku-skill-evaluator/v4.0/) · [版本详情](v4.0/README.md)

- **V4.0.2｜连续对局与管理员工具**：加入双方确认再战、重新匹配入口和 3D 骰子动画；管理员可管理 AI 战绩、竞技积分并清空指定账号的 AI 对局数据。  
  [版本详情](v4.0/README.md) · [管理员更新 PR #40](https://github.com/nkfff/gomoku-skill-evaluator/pull/40)

- **V4.0.1｜本地神经网络 AI 与体验修复**：加入 Gunuce 浏览器本地推理，首次缓存后支持游客离线对弈；修复不同主题下的状态栏文字对比度及离线资源缓存。  
  [Gunuce 使用与验证说明](v4.0/GUNUCE.md) · [版本详情](v4.0/README.md)

### 2026-10-30

- **V4.0｜视觉与竞技系统升级**：重构整体视觉；支持玩家选择黑白先手、AI 平局奖励、真人 PVP 服务端摇骰及排行榜荣誉头衔。  
  [在线体验](https://nkfff.github.io/gomoku-skill-evaluator/v4.0/) · [版本详情](v4.0/README.md)

### 2026-10-29

- **V3.4｜深层搜索 AI**：引入迭代加深 Alpha-Beta、Zobrist 置换表和战术延伸；修复难度快照与积分结算，并将搜索移入 Worker。  
  [在线体验](https://nkfff.github.io/gomoku-skill-evaluator/v3.4/) · [版本说明](v3.4/README.md)

- **V3.3｜王者 AI 与战术模式**：强化王者难度和随机连珠自适应搜索；残局升级为多步强制组合与唯一正确首着。  
  [在线体验](https://nkfff.github.io/gomoku-skill-evaluator/v3.3/) · [版本说明](v3.3/README.md)

### 2026-10-28

- **V3.1｜对弈界面优化**：按页面场景控制开始按钮和 AI 棋盘显示，减少非对弈页面干扰。  
  [在线体验](https://nkfff.github.io/gomoku-skill-evaluator/v3.1/) · [开发档案](docs/DEVELOPMENT_ROADMAP.md)

- **V3.0｜好友真人 PVP**：加入邀请码房间、实时落子、棋钟、断线重连、认输/和棋及独立 Elo。  
  [在线体验](https://nkfff.github.io/gomoku-skill-evaluator/v3.0/) · [开发档案](docs/DEVELOPMENT_ROADMAP.md)

- **V2.3｜低延迟与猫猫主题**：AI 对局本地即时执行，终局再云端结算；加入猫猫棋盘/棋子、全局主题联动与落子音效。  
  [在线体验](https://nkfff.github.io/gomoku-skill-evaluator/v2.3/) · [开发档案](docs/DEVELOPMENT_ROADMAP.md)

- **V2.2｜账号与积分稳定版**：建立云端账号、积分排行榜、皮肤商店、悔棋经济和管理员功能。  
  [稳定版入口](https://nkfff.github.io/gomoku-skill-evaluator/v2.2/) · [开发档案](docs/DEVELOPMENT_ROADMAP.md)

### 2026-10-27

- **V3.2｜特殊玩法初版**：加入残局挑战与随机 3–10 连珠模式，后续由 V3.3/V3.4 持续强化。  
  [在线体验](https://nkfff.github.io/gomoku-skill-evaluator/v3.2/) · [开发档案](docs/DEVELOPMENT_ROADMAP.md)

### 早期历史版本

- **V2.1｜棋力评估与复盘**：提供基础 AI 对弈、逐手棋谱、候选提示和落子质量评分。  
  [历史主页](https://nkfff.github.io/gomoku-skill-evaluator/) · [开发档案](docs/DEVELOPMENT_ROADMAP.md)
- **V1｜初始版本**：早期基础五子棋页面。  
  [历史版本](https://nkfff.github.io/gomoku-skill-evaluator/v1/)

## AI 研究分支（非线上游戏版本）

V4.1.x 是独立的 AI 训练与棋力研究线，不属于上述网页游戏发布版本；研究代码位于 `feat/4.1-teba-mcts`，不会替换线上 V4.0。训练方法、Checkpoint 对战结果与后续计划见 [AI 训练说明](https://github.com/nkfff/gomoku-skill-evaluator/blob/feat/4.1-teba-mcts/ai-training/README.md)。
