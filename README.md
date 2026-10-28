# 五子棋棋力评估 · Gomoku Skill Evaluator

**稳定版：V2.1** | [🎮 在线下棋](https://nkfff.github.io/gomoku-skill-evaluator/) | **[V2.2 游客预览](https://nkfff.github.io/gomoku-skill-evaluator/v2.2/)** | [V1 历史版](https://nkfff.github.io/gomoku-skill-evaluator/v1/)

一个基于浏览器的五子棋 AI 对战与棋力复盘工具，15 × 15 棋盘、黑棋先手。V2.1 保持为稳定主页；V2.2 已发布到独立预览路径，账号后端仍需配置。

## 在线版本

| 版本 | 在线地址 | 状态 |
| --- | --- | --- |
| **V2.1 稳定版** | https://nkfff.github.io/gomoku-skill-evaluator/ | 原正式入口，保持不变 |
| **V2.2 游客预览** | https://nkfff.github.io/gomoku-skill-evaluator/v2.2/ | 已部署，可体验前端功能；云端账号未连接 |
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
- **娱乐化本局小结**：以更轻松的文字总结胜负、落子表现和关键机会。
- **账号与管理员界面**：邮箱注册/登录、找回密码、用户查询、积分调整、封禁及审计日志的代码已开发，等待云端服务配置。

> **当前 V2.2 只完成了独立游客预览部署。** `v2.2/config.js` 已配置 Supabase Project URL 与 Publishable Key；Worker URL 和 D1 数据库尚未配置。账号注册、云端积分、管理员操作和跨玩家排行榜目前仍不可用；游客积分存储在本浏览器中，不应视为正式成绩。

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

V2.2 使用 **Supabase Auth + Cloudflare Workers + Cloudflare D1**。当前 Supabase Project URL 与 Publishable Key 已写入 `v2.2/config.js`；账号注册仍未启用，因为 Worker URL 和 D1 数据库尚未部署。

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

在 GitHub 的 **Actions → Deploy V2.2 Cloudflare Worker → Run workflow** 中选择源分支 `feature/v2.2-accounts-customization`。工作流会运行测试、执行 D1 迁移并部署 Worker。

部署成功后，从 Actions 日志复制 Worker 的 `workers.dev` URL，写入 `v2.2/config.js`：

```js
window.GOMOKU_API_URL = "https://your-worker.your-subdomain.workers.dev";
window.GOMOKU_SUPABASE_URL = "https://khnlxucuvagtpdbooexa.supabase.co";
window.GOMOKU_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_...";
```

Supabase URL 和 Publishable Key 已配置；这里只需替换 Worker URL。提交后等待 GitHub Pages 部署成功。

### 4. 启用管理员

先通过预览页注册账号并完成邮箱验证，再到 Supabase **Authentication → Users** 复制自己的 User ID，将其添加为 GitHub Actions secret `ADMIN_USER_ID`，重新运行 Worker 部署工作流。管理员权限只由服务端配置的 UUID 决定。

### 5. 上线前检查

测试注册、邮件验证、登录/登出、胜局积分、皮肤购买、额外悔棋、管理员调分、封禁、审计日志与游客隔离。未完成端到端测试前，不要把 V2.2 提升为正式主页。

