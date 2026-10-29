# 五子棋棋力评估 · Gomoku Skill Evaluator

**当前稳定版：V2.2** | [🎮 V2.2 稳定版](https://nkfff.github.io/gomoku-skill-evaluator/v2.2/) | [🐱 V2.3 稳定版](https://nkfff.github.io/gomoku-skill-evaluator/v2.3/) | [🎯 V3.2 特殊模式测试版](https://nkfff.github.io/gomoku-skill-evaluator/v3.2/) | [🐾 V3.1 UI 优化版](https://nkfff.github.io/gomoku-skill-evaluator/v3.1/) | [V3.0 PVP 稳定版](https://nkfff.github.io/gomoku-skill-evaluator/v3.0/) | [V2.1 旧版主页](https://nkfff.github.io/gomoku-skill-evaluator/) | [V1 历史版](https://nkfff.github.io/gomoku-skill-evaluator/v1/)

> **最近更新：2026-10-28** · V3.1 UI 优化测试版已发布；开始下棋按钮与 AI 棋盘按页面状态显示。

一个基于浏览器的五子棋 AI 对战与棋力复盘工具，15 × 15 棋盘、黑棋先手。**V2.2 仍是当前稳定版本，V2.3 为已部署的预览版本**；各版本使用独立入口，V2.1 根路径继续保留兼容。V2.3 前端 Pages、Cloudflare Worker 与 D1 迁移均已部署，自动化检查通过；完整真实浏览器验收仍待完成。

## 在线版本

| 版本 | 在线地址 | 状态 |
| --- | --- | --- |
| **V2.2 稳定版** | https://nkfff.github.io/gomoku-skill-evaluator/v2.2/ | 当前稳定入口；前端与 Worker 部署成功，自动化测试通过（2026-10-28） |
| **V2.3 预览版** | https://nkfff.github.io/gomoku-skill-evaluator/v2.3/ | 已部署：本地即时对局、猫猫主题棋盘/棋子、落子音效与终局云端结算；仍需真实浏览器验收 |
| **V3.1 UI 优化版** | https://nkfff.github.io/gomoku-skill-evaluator/v3.1/ | 基于 V3.0；开始下棋按钮仅在对弈页显示，AI 棋盘仅在对弈/复盘页显示 |
| **V3.2 特殊模式测试版** | https://nkfff.github.io/gomoku-skill-evaluator/v3.2/ | 在 V3.0 基础上新增自动残局挑战与随机 3–10 连珠；残局奖励经服务端验证，等待实战验收 |
| **V3.0 PVP 稳定版** | https://nkfff.github.io/gomoku-skill-evaluator/v3.0/ | 以当前 V2.3 页面、主题系统、账号与本地棋力引擎为基础，新增好友真人 PVP 与独立 Elo；好友 PVP 已通过用户实测 |
| V2.1 旧版主页 | https://nkfff.github.io/gomoku-skill-evaluator/ | 保留兼容，不作为当前版本入口 |
| V2.1 预览快照 | https://nkfff.github.io/gomoku-skill-evaluator/v2.1/ | 旧预览备份 |
| V1 历史版 | https://nkfff.github.io/gomoku-skill-evaluator/v1/ | 保留的旧版页面 |

## V2.3 预览版（2026-10-28）

V2.3 已部署至独立预览入口，**V2.2 稳定版与 V2.1 兼容入口保持不变**。

- **低延迟**：AI 落子、计时与棋谱在浏览器本地执行，不再逐手等待网络响应。
- **终局结算**：登录对局在结束后提交棋谱，由 Cloudflare Worker 验证并结算；断网时暂存本地，可重试同步。
- **全局皮肤联动（本次修复）**：6 种棋盘主题（经典榉木、翡翠、暗夜星河、樱花庭院、猫咪咖啡馆、曜金）分别控制整站背景、面板、文字、表单与提示样式；6 种棋子主题（经典玉石、水晶冰魄、水墨丹青、霓虹宇宙、黑曜珍珠、猫猫软糖）同步控制页面氛围光晕、面板光效、按钮、选中态、链接强调色和交互光效。棋盘与棋子可自由组合，12 种皮肤都会影响全站视觉，不再只有猫猫主题影响外观。
- **猫猫头图片棋子（本次修复）**：猫猫软糖改用黑/白透明 WebP 图片素材，按黑猫与白猫参考图呈现圆润立体外观；主棋盘和商店试穿预览共用素材，最后一步红色标记保留。 本次补充图片资源版本号、加载成功/失败状态与自动重绘，并在页面中预加载两张图片，避免浏览器缓存旧脚本或图片请求失败后未刷新。
- **主题修复测试**：新增 6 个棋盘主题与 6 个棋子主题的覆盖测试，防止全局风格回归。
- **部署与检查**：[Worker 部署及线上健康检查](https://github.com/nkfff/gomoku-skill-evaluator/actions/runs/40670158103)、[自动化测试](https://github.com/nkfff/gomoku-skill-evaluator/actions/runs/40670158258)、[GitHub Pages 发布](https://github.com/nkfff/gomoku-skill-evaluator/actions/runs/40670508182)。

注意：自动化测试和部署检查已通过；胜负结算、断网重试及移动端外观仍建议在真实浏览器中做一次人工验收。

## 最近更新（2026-10-28）

- **综合积分排行榜**：新手、进阶、大师 AI 获胜分别奖励 10、30、80 分；按累计获胜奖励积分加胜率修正分排序。原始胜率独立展示，胜率高于 50% 可加分、低于 50% 会扣分，综合积分下限为 0。
- **排名与消费余额分离**：购买皮肤、付费悔棋等消费不扣除竞技排名分，避免经济系统直接改变排行榜名次。
- **邮箱确认反馈**：邮箱验证链接返回后，游戏页顶部显示成功、未自动登录或失败提示。
- **手动开始计时**：新开局后计时为 `00:00`；点击“开始下棋”后才开始计时并允许落子。
- **稳定性与部署**：自动化语法检查/回归测试通过，GitHub Pages 前端与 Cloudflare Worker 部署工作流成功。

## 功能概览

### V2.1 旧版功能（兼容保留）

- 新手、进阶、大师三档 AI 对战。
- 逐手棋谱、思考时间、复盘跳转、候选落点建议。
- 棋力评分：Top-1 / Top-3、落子估计损失、严重失误率、复杂度加权准确度、关键攻防成功率和样本可信度。
- 终局冻结计时，结束后禁止悔棋。
- 本地积分、皮肤商店、棋谱 JSON 导出。

### V2.2 稳定版

- **棋盘预览**：购买前可试穿棋盘配色。
- **独立棋子皮肤**：棋盘和棋子可以分别选择、自由搭配。
- **悔棋经济**：每局前 3 次免费，第 4 次起每次 10 积分；对局结束后不能悔棋。
- **点击才显示落子提示**：点击“落子提示”后显示最多 3 个候选位置；落子、新开局、悔棋或离开对弈页后清除。
- **手动开始与计时**：页面打开或新开一局时计时保持 `00:00`；只有点击“开始下棋”后才启动总计时与本手思考计时，开始前不能落子。
- **邮箱验证反馈**：完成 Supabase 邮箱确认后，在游戏页面顶部显示验证结果；若未自动登录，会提示用户进入账号中心手动登录。
- **娱乐化本局小结**：以更轻松的文字总结胜负、落子表现和关键机会。
- **综合积分排行榜**：单独展示原始胜率；排名按综合积分降序。综合积分 = 按 AI 难度累计的获胜奖励积分（新手 10、进阶 30、大师 80）+ 胜率修正分。修正胜率为 `(胜局 + 2.5) / (总对局数 + 5) × 100`；胜率修正分为 `round((修正胜率 − 50) × min(总对局数, 20) / 10)`，高于 50% 加分、低于 50% 扣分，并将综合积分下限设为 0；消费积分不会降低综合排名分。
- **账号与管理员界面**：邮箱注册/登录、找回密码、用户查询、积分调整、封禁及审计日志；登录后可设置 2–24 个字符的自定义显示名称。管理员可以调整本人积分，但不能封禁或重置本人账号。

> **V2.2 稳定版状态（2026-10-28）**：Supabase、Cloudflare Worker 与 D1 已配置；本轮综合积分榜、邮箱确认反馈和手动计时已更新。GitHub Actions 自动化测试、GitHub Pages 部署及 Cloudflare Worker 部署均成功。游客积分仍保存在本地浏览器中，不应视为正式云端成绩。

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

## V2.2 云端账号系统与运维说明

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

### 5. 稳定版回归检查

V2.2 当前稳定入口已部署，自动化测试与部署工作流均通过。若修改账号配置、积分规则、Worker API 或数据库迁移，仍应回归测试注册、邮箱确认、登录/登出、开始按钮与计时、不同难度获胜奖励、综合积分排序、皮肤购买、额外悔棋、管理员权限边界、审计日志与游客隔离。



## V3.0 好友真人 PVP（测试版）

- **在线入口：** https://nkfff.github.io/gomoku-skill-evaluator/v3.0/
- **实时对战服务：** https://gomoku-v3-api.1395598907.workers.dev
- 使用现有账号体系，真人 Elo 段位与 AI 积分分开统计；服务端校验落子、时钟和胜负。
- 当前为测试版，正式邀请好友对局前请先确认登录、创建房间和重连流程正常。
- Supabase Authentication 的 Redirect URLs 需要允许：`https://nkfff.github.io/gomoku-skill-evaluator/v3.0/`。


## V3.0 好友真人 PVP 测试版（2026-10-28）

V3.0 **直接继承当前 V2.3 预览版的页面、全局皮肤主题、账号模块、本地 AI 引擎和棋力评估模块**，并在独立的 `/v3.0/` 入口增加真人对战，不覆盖 V2.3。

- **在线入口：** https://nkfff.github.io/gomoku-skill-evaluator/v3.0/
- **实时服务：** https://gomoku-v3-api.1395598907.workers.dev/api/health
- **真人对局：** 邀请码房间、实时落子、双方准备、10 分钟棋钟、认输/和棋、断线重连、真人 Elo 排行榜与历史战绩。
- **数据隔离：** 真人 Elo 与 AI 积分分开保存，不改变 V2.3 的 AI 结算逻辑。
- **验收状态：** GitHub Pages 部署与自动化检查通过；请使用两个账号实测注册/登录、创建/加入房间、连续落子、结束结算及重连。尚未宣称通过真实双人完整对局验收。



## V3.1 UI 优化版（2026-10-28）

V3.1 基于 V3.0 创建独立入口，不覆盖 V3.0、V2.3 或稳定版。

- **开始下棋按钮**：只在「对弈」页面显示；复盘、商店、排行榜、好友 PVP 和账号管理页面不显示。
- **AI 棋盘与操作区**：仅在「对弈」和「复盘」页面显示；其他页面隐藏 AI 棋盘区域，避免挤占可用空间。
- **好友 PVP**：真人棋盘独立保留，不受 AI 棋盘显示规则影响；猫猫主题、账号、AI 引擎和棋力评估均继承 V3.0。
- **在线入口：** https://nkfff.github.io/gomoku-skill-evaluator/v3.1/
- **验收状态：** 自动化检查覆盖按钮/棋盘显示规则与资源引用；部署完成后仍建议实际切换各个页面验收。


## V3.2 特殊模式（测试版）

V3.2 基于 V3.0 创建独立入口，原 V3.0、V2.3 和稳定版入口不覆盖。

- **残局挑战：** 初级/进阶/大师对应唯一直接成五、双路杀、三路杀；每局随机生成棋形并经过程序校验。通关奖励分别为 10/30/80 积分。
- **积分安全：** 登录用户由 V3 API 生成挑战、校验制胜点并在 D1 记录一次性领取；每日最多生成 30 道、领取 10 次。游客奖励保存在本地浏览器。
- **随机连珠：** 每局随机 3–10 连珠，棋盘按连珠数适配，尺寸满足 `size >= 2 × connect + 3`，空盘开局以避免随机障碍导致的死局。
- **主题继承：** 两种新模式沿用 V3.0 棋盘/棋子皮肤，棋盘在窄屏下自适应缩放。
- **在线入口：** https://nkfff.github.io/gomoku-skill-evaluator/v3.2/
- **状态：** 测试版；需进行浏览器交互和登录账号奖励实测。
