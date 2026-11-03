# 五子棋棋力评估 · Gomoku Skill Evaluator

> 一个集 AI 对弈、棋力评估、残局训练、随机连珠与好友真人 PVP 于一体的浏览器五子棋项目。

**当前稳定版本：** [V4.0.4](https://nkfff.github.io/gomoku-skill-evaluator/v4.0/)  
**项目档案：** [完整开发规划与历史记录](docs/DEVELOPMENT_ROADMAP.md)

## 项目功能

- **AI 对弈与棋力评估：** 多档 AI、逐手棋谱、复盘与落子质量分析。
- **训练模式：** 多步残局挑战、3–10 连珠随机模式。
- **好友竞技：** 邀请码房间、实时对战、和棋/认输、Elo 排名与连续对局。
- **账号与成长：** 云端账号、积分、排行榜、棋盘和棋子主题。

技术架构：前端使用 HTML/CSS/JavaScript，部署于 GitHub Pages；账号认证使用 Supabase；云端业务使用 Cloudflare Workers、D1 与 Durable Objects。

## 版本更新记录

按发布日期倒序排列；每个版本仅保留核心变化，完整功能、技术细节和测试记录请查看对应文档。

### 2026-11-04

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
