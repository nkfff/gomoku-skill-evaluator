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

> **当前 V2.2 只完成了独立游客预览部署。** `v2.2/config.js` 中的 Supabase 与 Worker 配置仍为空。账号注册、云端积分、管理员操作和跨玩家排行榜目前不能使用；游客积分存储在本浏览器中，不应视为正式成绩。

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

V2.2 使用 **Supabase Auth + Cloudflare Workers + Cloudflare D1**：Supabase 负责账号认证，Worker 验证 JWT 并处理游戏 API，D1 保存用户资料、积分、皮肤、棋谱和管理审计记录。

**登录 Supabase 控制台并不等于已连接项目。** 需要创建项目并完成以下步骤后，V2.2 账号功能才会启用。

1. **创建 Supabase 项目**，在 Authentication 中启用 Email/Password；配置 Site URL 与 Redirect URLs，加入 `https://nkfff.github.io/gomoku-skill-evaluator/v2.2/`。建议开启邮箱验证。
2. **配置 JWT 签名密钥**：Worker 使用 Supabase 项目的 JWKS 验证用户令牌；按开发分支说明启用兼容的非对称 ES256 或 RS256 签名密钥。参考 [Supabase JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys)。
3. **创建 Cloudflare D1**，登录 Cloudflare 并运行：
   ```bash
   npx wrangler login
   npx wrangler d1 create gomoku-v2
   ```
   将返回的数据库 ID 写入开发分支的 `wrangler.toml`，替换 `REPLACE_WITH_YOUR_D1_DATABASE_ID`。
4. **部署数据库迁移**：在开发分支安装依赖后运行 `npx wrangler d1 migrations apply gomoku-v2 --remote`。
5. **配置 Worker 环境变量**：
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put ADMIN_USER_ID
   ```
   分别输入 Supabase Project URL，以及管理员本人在 Supabase Authentication → Users 中的真实 User ID。管理员应先注册自己的账号，再设置该 ID。不要将 `service_role` 或任何私密密钥放进前端。
6. **部署 Worker**：运行 `npx wrangler deploy`，记录 Worker URL。
7. **配置前端**：修改开发分支及预览目录的 `config.js`，填入 Worker URL、Supabase Project URL 与 Supabase **publishable key**：
   ```js
   window.GOMOKU_API_URL = "https://your-worker.your-subdomain.workers.dev";
   window.GOMOKU_SUPABASE_URL = "https://your-project.supabase.co";
   window.GOMOKU_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_xxx";
   ```
8. 完成注册、邮箱验证、登录/登出、胜局积分、皮肤购买、付费悔棋、管理员调分/封禁和审计日志的端到端验收后，再考虑将 V2.2 提升为正式主页。

详细代码和部署说明见 [V2.2 开发分支 README](https://github.com/nkfff/gomoku-skill-evaluator/tree/feature/v2.2-accounts-customization)。**不要在云端服务未配置、权限与积分事务未验收前公开启用管理员 API。**

## 本地开发与测试

V2.1 / V2.2 使用 ES Modules，需通过 HTTP 运行，不能直接双击 `index.html`。

```bash
python3 -m http.server 8080
# V2.1: http://localhost:8080/
# V2.2 预览文件放在 v2.2/ 目录时访问：
# http://localhost:8080/v2.2/
```

在 V2.2 开发分支运行：

```bash
npm install
npm test
npm run check
```

GitHub Pages 从 `main / (root)` 发布。根目录为 V2.1 稳定版，`v2.1/` 与 `v2.2/` 为独立静态快照；V2.2 开发源代码保存在 `feature/v2.2-accounts-customization` 分支。

## 隐私与积分

- 云端账号启用前，昵称、积分、皮肤和游客 ID 仅保存在当前浏览器的 `localStorage`，不会跨设备同步；清除网站数据可能丢失。
- 正式账号使用认证服务返回的唯一用户 ID，不应使用 IP 地址作为账号标识。IP 可能共享、变化，不适合作为稳定身份。
- 管理员操作需要服务端校验权限并写入审计日志；积分增减应同时写入流水。
- 任何公开排行榜还需要限流、防刷、滥用监控与端到端测试。
