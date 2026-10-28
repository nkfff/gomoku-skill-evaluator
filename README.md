# 五子棋 V2.2 稳定版与 V2.3 预览版

**当前稳定版：V2.2 · V2.3 预览版已部署（本地即时对局与猫猫主题）**

[🎮 V2.2 稳定版](https://nkfff.github.io/gomoku-skill-evaluator/v2.2/) · [🐱 V2.3 预览版](https://nkfff.github.io/gomoku-skill-evaluator/v2.3/) · [V2.1 旧版主页](https://nkfff.github.io/gomoku-skill-evaluator/) · [GitHub Actions 部署记录](https://github.com/nkfff/gomoku-skill-evaluator/actions)

> **最近更新：2026-10-28。** V2.2 继续作为稳定版；V2.3 已部署到独立 `/v2.3/` 预览入口，V2.1 根路径继续兼容。V2.3 自动化检查、Cloudflare Worker/D1 部署与最新 GitHub Pages 发布均成功；真实浏览器端到端验收仍待完成。

## V2.3 预览版发布记录（2026-10-28）

在线入口：[打开 V2.3 猫猫主题预览版](https://nkfff.github.io/gomoku-skill-evaluator/v2.3/)。

- **本地即时对局**：落子、AI 行棋、计时与棋谱在浏览器本地运行，不再逐手等待 Worker 响应。
- **终局云端结算**：登录用户在对局结束后提交事件流，由 Worker 验证棋谱、AI 应手、胜负与悔棋费用后结算。
- **断网重试与防重复结算**：成绩暂存浏览器待同步队列；恢复网络或手动重试时重新提交，D1 migration 0003 使用 `settled_at` 标记避免重复发放。
- **猫猫主题与音效**：奶油粉猫咪咖啡馆棋盘、猫爪装饰、猫猫头棋子、可开关的 Web Audio 落子音效。
- **部署与自动化检查**：[Worker 部署及线上健康检查](https://github.com/nkfff/gomoku-skill-evaluator/actions/runs/40670158103)、[V2.3 测试](https://github.com/nkfff/gomoku-skill-evaluator/actions/runs/40670158258)、[GitHub Pages 最新发布](https://github.com/nkfff/gomoku-skill-evaluator/actions/runs/40670508182)。

**验收边界：** 自动化测试、D1 迁移、Worker 健康检查和 Pages 发布均已通过；三档 AI 全流程、胜负积分、断网恢复及移动端布局仍需真实浏览器人工验收。V2.2 稳定入口保持不变。

## V2.2 功能清单与本轮更新

1. **注册与管理员管理**：邮箱注册、密码登录、找回/修改密码；登录后可在账号中心自定义 2–24 个字符的显示名称，并同步到棋盘顶部、云端排行榜和管理员列表。管理员可查询账号、增减可消费积分（包括本人）、封禁/解封、重置游戏数据并查看审计日志；为避免失去管理权限，不能封禁或重置本人账号。后端使用已验证的 JWT `sub` 作为玩家 ID，**不再信任用户随意提交的 playerId**。
2. **棋盘预览**：在商店内点击“试穿”预览颜色，不消耗积分。
3. **棋子独立皮肤**：棋盘与棋子分开兑换、自由搭配。棋子：经典玉石、水晶冰魄、水墨丹青、霓虹宇宙、黑曜珍珠。
4. **悔棋规则**：每局前 3 次免费，第四次起每次 10 积分。结束后无法悔棋；云端悔棋需要服务器校验且记录费用。
5. **主动点击才显示提示**：只有点击“落子提示”，棋盘才显示三个编号候选点；下一手、新开局、悔棋、切换页面立即清除。异步旧结果不可重新出现。候选顺序是启发式优先级，**不是已校准的胜率**。
6. **有趣的本局小结**：按胜负、评分与关键机会生成有趣的局内描述，保留真实统计但避免机械堆砌术语。
7. **手动开始计时**：打开页面或点击“新开一局”时不启动计时；点击“开始下棋”才启动总计时和思考计时，开始前禁止落子。
8. **邮箱验证反馈**：Supabase 确认链接返回后，在游戏界面顶部显示验证成功或需要手动登录的提示，不再只更新隐藏的账号页消息。

## 运行模式

| 模式 | 是否需配置 | 身份 / 积分 / 商店 | 排行榜 |
|---|---|---|---|
| 游客模式 | 不需要 | 本浏览器 localStorage，积分可在本机修改 | 仅本人模拟数据 |
| 正式账号 | Supabase + Worker + D1 均已部署 | 服务器积分、账号 ID、皮肤 | 跨账号综合榜：综合积分降序（难度加权获胜奖励 + 胜率奖励）；原始胜率单独展示 |

> **不要将游客积分同步为云端正式积分。** 游客数据仅用于体验和升级前保存。云端功能未配置时，账号页面明确显示不可用，而不会伪装注册成功。

## 账号系统配置与部署记录

> Supabase Project URL、Publishable Key 与 Worker URL 已配置；Cloudflare Worker 与 D1 已部署。2026-10-28 更新后的综合积分榜、邮箱验证反馈、手动开始计时均已纳入代码；自动化测试及 Worker 部署工作流通过。

1. 在 Supabase Authentication → Providers 启用 Email/Password；在 Authentication → URL Configuration 的 Redirect URLs 中加入 https://nkfff.github.io/gomoku-skill-evaluator/v2.2/，建议开启邮箱验证。
2. 在 Supabase JWT Signing Keys 确认用户访问令牌使用 Worker 支持的非对称 ES256 或 RS256 签名密钥。参考 https://supabase.com/docs/guides/auth/signing-keys。
3. 在 Cloudflare 控制台创建 D1 数据库，名称为 gomoku-v2，复制数据库 UUID。
4. 创建 Cloudflare API Token，至少授予目标账号 Workers Scripts: Edit 和 D1: Edit 权限；记下 Cloudflare Account ID。
5. 在 GitHub 仓库 Settings → Secrets and variables → Actions 添加以下 repository secrets：

| Secret | 内容 |
|---|---|
| CLOUDFLARE_API_TOKEN | Cloudflare API Token，不要发到聊天或写入代码 |
| CLOUDFLARE_ACCOUNT_ID | Cloudflare Account ID |
| CLOUDFLARE_D1_DATABASE_ID | D1 数据库 UUID |
| SUPABASE_URL | https://khnlxucuvagtpdbooexa.supabase.co |
| ADMIN_USER_ID | 可先不设置，管理员注册账号后再添加 |

6. 在 GitHub Actions → Deploy V2.2 Cloudflare Worker → Run workflow 中选择源分支 feature/v2.2-accounts-customization。工作流会安装依赖、运行测试、执行 0001_init.sql 和 0002_accounts.sql 迁移并部署 Worker。
7. Worker 已部署，地址为 https://gomoku-v2-api.1395598907.workers.dev；main/v2.2/config.js 与开发分支 config.js 已写入该地址，Supabase Project URL 和 Publishable Key 也已配置。
8. 首次部署后，通过预览页注册并验证管理员邮箱。在 Supabase Authentication → Users 复制自己的 User ID，将其添加为 GitHub Actions secret ADMIN_USER_ID，再运行一次 Worker 部署工作流。只有服务端配置的 UUID 才拥有管理员权限。
9. 稳定版回归清单：注册与邮箱确认、登录/登出、开始按钮与计时、三档 AI 获胜奖励、综合积分排序与原始胜率、皮肤购买、额外悔棋、管理员权限边界、审计日志与游客隔离。自动化测试和部署工作流已通过；若后续修改代码或云端配置，应再次执行此清单。

前端只允许包含 Supabase Project URL 和 Publishable Key。绝不能把 service_role、数据库密码或 Cloudflare API Token 放入 config.js 或其他公开文件。

### 安全说明

- GitHub Pages 不能自行存储玩家账号或执行数据库写入，因此真实用户管理必须依赖可验证身份的后端。
- **管理员角色由 Worker 的 `ADMIN_USER_ID` 校验，不能由浏览器传入**；普通用户不能直接修改积分。管理员可以调整本人积分，但不能封禁或重置本人账号。
- 密码由 Supabase Auth 管理，不在 D1 保存明文密码；管理员无法读取密码，用户可通过邮箱找回。
- 每次管理员操作应有审计日志，分数更改另有积分流水；排行榜按综合积分降序排序。原始胜率=`wins/(wins+losses+draws)` 并单独展示；修正胜率=`100*(wins+2.5)/(wins+losses+draws+5)`；胜率修正分=`round((修正胜率-50)*min(总对局数,20)/10)`，高于 50% 加分、低于 50% 扣分；综合积分=`max(0,累计获胜奖励积分+胜率修正分)`。每次获胜按难度奖励：新手 10、进阶 30、大师 80。综合积分是竞技排名分，不是可消费余额；购买皮肤或悔棋不会降低排名。
- IP 不等于唯一用户 ID：同一网络可有多人，移动网络 IP 也会变化。使用登录账户的 UUID 关联跨对局记录。
- 云端开放前，仍建议加 Cloudflare Turnstile、速率限制、滥用监控和更严格的数据库事务与端到端测试。

## 游戏规则和经济

| 项目 | 规则 |
|---|---|
| 新手 AI 胜利 | +10 积分 |
| 进阶 AI 胜利 | +30 积分 |
| 大师 AI 胜利 | +80 积分 |
| 免费悔棋 | 每局前 3 次 |
| 额外悔棋 | 每次 10 积分 |
| 棋盘兑换 | 0 / 60 / 150 / 260 / 500 积分 |
| 棋子兑换 | 0 / 45 / 85 / 140 / 220 积分 |

## 在线预览与本地开发

V2.2 稳定版在线入口：<https://nkfff.github.io/gomoku-skill-evaluator/v2.2/>。截至 2026-10-28，GitHub Pages 与 Cloudflare Worker 部署成功，自动化回归测试通过。游客本地积分仅用于本机体验，不应当作云端正式成绩。

V2.1 旧版主页（兼容保留）：<https://nkfff.github.io/gomoku-skill-evaluator/>。

## 本地开发与测试

```bash
python3 -m http.server 8080
# 浏览器访问 http://localhost:8080/
npm test
npm run check
```

`npm test` 测试五连判断、初级搜索、V2.1 评分、点击提示、综合积分榜公式、手动开始计时、邮箱确认全局反馈与管理员权限边界；`npm run check` 检查语法。**自动测试通过不等同于 Supabase/Cloudflare 线上集成验证通过。**

## 项目文件

- `index.html`：V2.2 页面（账号、提示、皮肤预览）
- `src/app.js`：游戏、悔棋、提示、商店与娱乐小结
- `src/account.js`：注册登录和管理员界面
- `src/engine.js` / `src/assessment.js`：棋局引擎与复盘
- `worker/index.js`：受认证保护的云端玩家、积分、管理员 API
- `migrations/0002_accounts.sql`：账号与积分审计表升级
- `migrations/0003_local_first_settlement.sql`：V2.3 终局结算幂等标记
- `config.js`：三个公开配置；Supabase URL、Publishable Key 与 Worker URL 均已配置
- `test/v2.2-ui.test.js`：提示、综合积分排名、原始胜率、手动计时、邮箱验证反馈和管理员自调积分规则验收

当前 V2.2 稳定入口为独立路径 `/v2.2/`；根路径仍保留 V2.1 旧版。自动化测试与部署成功不替代后续安全维护；请勿将 service_role、数据库密码或 Cloudflare API Token 放入公开代码。


## V2.3 开发中（2026-10-28）

V2.2 稳定入口继续保留。本分支开始实现以下升级：

- **本地即时对局**：落子、AI 行棋、计时和棋谱在浏览器本地运行，不再每手等待 Worker 往返。开局仅后台创建云端会话，不阻塞第一手。
- **终局云端结算**：登录用户结束对局后提交精简事件流；Worker 复核落子顺序、AI 候选应手、胜负和悔棋记录，再更新云端积分。服务端要求先注册会话，并用 `settled_at` 防止并发重复结算。
- **断网容错**：终局提交先写入本地待同步队列，网络恢复或点击“重试上传”后再次提交；服务端使用对局 ID 做幂等检查。
- **猫咪咖啡馆棋盘**：奶油粉棋盘、猫爪装饰；新增“猫猫软糖”动漫猫头棋子，可分别试穿与装备。
- **落子音效**：使用 Web Audio API 生成轻量音效，提供开关，不需要下载音频文件。
- **兼容性**：游客继续使用本地积分；登录用户的正式云端成绩只在服务端验证成功后结算。旧版在线 API 保留，避免直接删除旧接口。

> 当前为开发分支，完成自动化回归和 Worker 部署前不应替代 V2.2 稳定版。部署前运行 `npm run check` 和 `npm test`，再从 GitHub Actions 部署 Worker。
