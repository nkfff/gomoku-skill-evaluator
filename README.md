# 五子棋棋力评估 · Gomoku Skill Evaluator

**稳定版：V2.1** | [🎮 在线下棋](https://nkfff.github.io/gomoku-skill-evaluator/) | **[V2.2 游客预览](https://nkfff.github.io/gomoku-skill-evaluator/v2.2/)** | [V1 历史版](https://nkfff.github.io/gomoku-skill-evaluator/v1/)

一个基于浏览器的五子棋 AI 对战与棋力复盘工具，15 × 15 棋盘、黑棋先手。V2.1 保持为稳定主页；V2.2 已发布到独立预览路径；本次综合积分榜、邮箱验证反馈与手动开始计时已提交代码，前端需等待 Pages 更新，Worker 后端需重新部署并完成回归验证。

## 在线版本

| 版本 | 在线地址 | 状态 |
| --- | --- | --- |
| **V2.1 稳定版** | https://nkfff.github.io/gomoku-skill-evaluator/ | 原正式入口，保持不变 |
| **V2.2 游客预览** | https://nkfff.github.io/gomoku-skill-evaluator/v2.2/ | 前端代码已更新；综合积分榜与 Worker 后端需重新部署并验收 |
| V2.1 预览快照 | https://nkfff.github.io/gomoku-skill-evaluator/v2.1/ | 旧预览备份 |
| V1 历史版 | https://nkfff.github.io/gomoku-skill-evaluator/v1/ | 保留的旧版页面 |

## 功能概览

### V2.1 稳定版

- 新手、进阶、大师三档 AI 对战。
- 逐手棋谱、思考时间、复盘跳转、候选落点建议。
- 棋力评分：Top-1 / Top-3、落子估计损失、严重失误率、复杂度加权准确度、关键攻防成功率和样本可信度。
- 终局冻结计时，结束后禁止悔棋。
- 本地积分、皮肤商店、棋谱 JSON 导出。

### V2.2 预览版

- **棋盘预览**：购买前可试穿棋盘配色。
- **独立棋子皮肤**：棋盘和棋子可以分别选择、自由搭配。
- **悔棋经济**：每局前 3 次免费，第 4 次起每次 10 积分；对局结束后不能悔棋。
- **点击才显示落子提示**：点击“落子提示”后显示最多 3 个候选位置；落子、新开局、悔棋或离开对弈页后清除。
- **手动开始与计时**：页面打开或新开一局时计时保持 `00:00`；只有点击“开始下棋”后才启动总计时与本手思考计时，开始前不能落子。
- **邮箱验证反馈**：完成 Supabase 邮箱确认后，在游戏页面顶部显示验证结果；若未自动登录，会提示用户进入账号中心手动登录。
- **娱乐化本局小结**：以更轻松的文字总结胜负、落子表现和关键机会。
- **综合积分排行榜**：单独展示原始胜率；排名按综合积分降序。综合积分 = 按 AI 难度累计的获胜奖励积分（新手 10、进阶 30、大师 80）+ 胜率奖励。修正胜率为 `(胜局 + 2.5) / (总对局数 + 5) × 100`；胜率奖励为 `round(max(0, 修正胜率 − 50) × min(总对局数, 20) / 10)`，减少小样本冲榜；消费积分不会降低综合排名分。
- **账号与管理员界面**：邮箱注册/登录、找回密码、用户查询、积分调整、封禁及审计日志；登录后可设置 2–24 个字符的自定义显示名称。管理员可以调整本人积分，但不能封禁或重置本人账号。

> **V2.2 云端基础设施已部署。** `v2.2/config.js` 已配置 Supabase Project URL、Publishable Key 和 Worker URL；账号基础流程已测试稳定。新增胜率排名和管理员自调积分规则需要随本次更新重新验证。游客积分仍保存在本地浏览器中，不应视为正式成绩。

## V2.1 评分说明

每手落子使用有限两层的候选着法与对手回应搜索：

- **Q**：复杂度加权的平均落子准确度（0–100）。
- **T**：存在明确、可处理的直接攻防机会时的成功率（百分制）。
- **E**：可评分着法中的严重失误率（百分制）。

有战术机会：

```text
分数 = 0.75 × Q + 0.15 × T + 0.10 × (100 − E)
```

无战术机会：

```text
分数 = 0.90 × Q + 0.10 × (100 − E)
```

对局长短不会直接增加或扣除分数；样本量用于估计可信度。Top-1 / Top-3 仅展示，不直接加分。

**重要局限：** 当前引擎并非专业五子棋求解器。提示位置按有限搜索的候选优先级排序，不是经过校准的获胜概率；评分不能换算为 Elo、段位或真实胜率。

## V2.2 云端账号系统部署

V2.2 使用 **Supabase Auth + Cloudflare Workers + Cloudflare D1**。Supabase Project URL、Publishable Key 与 Worker URL 已写入 `v2.2/config.js`；首次 Worker 部署和 D1 迁移已成功。

### 1. 配置 Supabase

项目：`https://khnlxucuvagtpdbooexa.supabase.co`

- 在 **Authentication → Providers** 启用 Email/Password。
- 在 **Authentication → URL Configuration** 的 Redirect URLs 加入 `https://nkfff.github.io/gomoku-skill-evaluator/v2.2/`。
- 在 **JWT Signing Keys** 确认用户访问令牌使用 Worker 支持的 ES256 或 RS256 签名密钥。参考 [Supabase JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys)。

### 2. 准备 Cloudflare D1 和部署凭据

1. 在 Cloudflare 创建 D1 数据库，名称设为 `gomoku-v2`，复制数据库 UUID。
2. 创建 Cloudflare API Token，至少授予目标账号 **Workers Scripts: Edit**、**D1: Edit** 权限。
3. 在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加以下 repository secrets：

| Secret | 内容 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token，**不要发到聊天或写入代码** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `CLOUDFLARE_D1_DATABASE_ID` | D1 数据库 UUID |
| `SUPABASE_URL` | `https://khnlxucuvagtpdbooexa.supabase.co` |
| `ADMIN_USER_ID` | 可暂不设置，管理员账号注册后再添加 |

### 3. 运行自动部署

首次部署已成功完成：GitHub Actions 运行测试、执行 D1 迁移并部署了 Worker。Worker 地址：https://gomoku-v2-api.1395598907.workers.dev。如需重新部署，在 GitHub 的 **Actions → Deploy V2.2 Cloudflare Worker → Run workflow** 中选择源分支 `feature/v2.2-accounts-customization`。

Worker 已部署，地址为 `https://gomoku-v2-api.1395598907.workers.dev`。前端配置已写入该地址；后续重新部署时可参考以下配置格式：

```js
window.GOMOKU_API_URL = "https://gomoku-v2-api.1395598907.workers.dev";
window.GOMOKU_SUPABASE_URL = "https://khnlxucuvagtpdbooexa.supabase.co";
window.GOMOKU_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_...";
```

Supabase URL、Publishable Key 与 Worker URL 均已配置。

### 4. 启用管理员

先通过预览页注册账号并完成邮箱验证，再到 Supabase **Authentication → Users** 复制自己的 User ID，将其添加为 GitHub Actions secret `ADMIN_USER_ID`，重新运行 Worker 部署工作流。管理员权限只由服务端配置的 UUID 决定。

### 5. 上线前检查

测试注册、邮箱确认反馈、登录/登出、开始按钮与计时、各难度获胜奖励、综合积分排序与原始胜率、皮肤购买、额外悔棋、管理员调整本人及其他用户积分、禁止自我封禁/重置、审计日志与游客隔离。新规则通过端到端验证后，再考虑将 V2.2 提升为正式主页。

