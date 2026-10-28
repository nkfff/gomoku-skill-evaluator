# 五子棋 V2.2 · 账号与个性化大升级（开发版）

**[🎮 在线游客预览](https://nkfff.github.io/gomoku-skill-evaluator/v2.2/)** · [V2.1 稳定主页](https://nkfff.github.io/gomoku-skill-evaluator/) · [GitHub Actions 部署记录](https://github.com/nkfff/gomoku-skill-evaluator/actions)

> 本分支是 V2.2 开发源代码，尚未合并为 `main` 根目录正式版。独立游客预览快照已部署到 `main/v2.2/`，V2.1 稳定主页保持不变。**Supabase、Cloudflare Worker 与 D1 已部署，账号基础流程已测试稳定**；本次胜率排名和管理员自调积分规则仍需在更新后复验。

## 六大升级

1. **注册与管理员管理**：邮箱注册、密码登录、找回/修改密码；登录后可在账号中心自定义 2–24 个字符的显示名称，并同步到棋盘顶部、云端排行榜和管理员列表。管理员可查询账号、增减可消费积分（包括本人）、封禁/解封、重置游戏数据并查看审计日志；为避免失去管理权限，不能封禁或重置本人账号。后端使用已验证的 JWT `sub` 作为玩家 ID，**不再信任用户随意提交的 playerId**。
2. **棋盘预览**：在商店内点击“试穿”预览颜色，不消耗积分。
3. **棋子独立皮肤**：棋盘与棋子分开兑换、自由搭配。棋子：经典玉石、水晶冰魄、水墨丹青、霓虹宇宙、黑曜珍珠。
4. **悔棋规则**：每局前 3 次免费，第四次起每次 10 积分。结束后无法悔棋；云端悔棋需要服务器校验且记录费用。
5. **主动点击才显示提示**：只有点击“落子提示”，棋盘才显示三个编号候选点；下一手、新开局、悔棋、切换页面立即清除。异步旧结果不可重新出现。候选顺序是启发式优先级，**不是已校准的胜率**。
6. **有趣的本局小结**：按胜负、评分与关键机会生成有趣的局内描述，保留真实统计但避免机械堆砌术语。

## 运行模式

| 模式 | 是否需配置 | 身份 / 积分 / 商店 | 排行榜 |
|---|---|---|---|
| 游客模式 | 不需要 | 本浏览器 localStorage，积分可在本机修改 | 仅本人模拟数据 |
| 正式账号 | Supabase + Worker + D1 均已部署 | 服务器积分、账号 ID、皮肤 | 跨账号综合榜：修正胜率 → 总对局数 → 累计获胜积分 |

> **不要将游客积分同步为云端正式积分。** 游客数据仅用于体验和升级前保存。云端功能未配置时，账号页面明确显示不可用，而不会伪装注册成功。

## 创建真正的账号系统

> Supabase Project URL 与 Publishable Key 已配置在开发分支的 config.js 和 V2.2 预览配置中。Cloudflare Worker 与 D1 已部署；账号基础流程已测试稳定。本次更新后需重新验证排行榜排序与管理员自调积分。

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
9. 更新后完整测试注册、邮件验证、登录/登出、胜局积分、皮肤购买、额外悔棋、排行榜胜率与排序、管理员调整本人及其他用户积分、禁止自我封禁/重置、审计日志与游客隔离。完成端到端测试后再考虑合并到 main。

前端只允许包含 Supabase Project URL 和 Publishable Key。绝不能把 service_role、数据库密码或 Cloudflare API Token 放入 config.js 或其他公开文件。

### 安全说明

- GitHub Pages 不能自行存储玩家账号或执行数据库写入，因此真实用户管理必须依赖可验证身份的后端。
- **管理员角色由 Worker 的 `ADMIN_USER_ID` 校验，不能由浏览器传入**；普通用户不能直接修改积分。管理员可以调整本人积分，但不能封禁或重置本人账号。
- 密码由 Supabase Auth 管理，不在 D1 保存明文密码；管理员无法读取密码，用户可通过邮箱找回。
- 每次管理员操作应有审计日志，分数更改另有积分流水；排行榜按修正胜率、总对局数、累计获胜积分排序。原始胜率=`wins/(wins+losses+draws)`；修正胜率=`(wins+2.5)/(wins+losses+draws+5)`，相当于 5 局、50% 胜率的平滑先验；买皮肤不影响累计获胜积分。
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

在线 V2.2 预览：<https://nkfff.github.io/gomoku-skill-evaluator/v2.2/>。Supabase 与 Cloudflare Worker/D1 已首次部署，前端已配置 Worker 地址；请继续完成账号注册、邮箱验证、积分和管理员流程的端到端测试。游客本地积分不应当作正式排行数据。

V2.1 稳定主页：<https://nkfff.github.io/gomoku-skill-evaluator/>。

## 本地开发与测试

```bash
python3 -m http.server 8080
# 浏览器访问 http://localhost:8080/
npm test
npm run check
```

`npm test` 测试五连判断、初级搜索、V2.1 评分、V2.2 HTML 按钮接线与点击提示显示规则；`npm run check` 检查语法。**自动测试通过不等同于 Supabase/Cloudflare 线上集成验证通过。**

## 项目文件

- `index.html`：V2.2 页面（账号、提示、皮肤预览）
- `src/app.js`：游戏、悔棋、提示、商店与娱乐小结
- `src/account.js`：注册登录和管理员界面
- `src/engine.js` / `src/assessment.js`：棋局引擎与复盘
- `worker/index.js`：受认证保护的云端玩家、积分、管理员 API
- `migrations/0002_accounts.sql`：账号与积分审计表升级
- `config.js`：三个公开配置；Supabase URL 和 Publishable Key 已配置，Worker URL 待部署后填写
- `test/v2.2-ui.test.js`：提示、排行榜胜率/排序和管理员自调积分规则验收

正式上线仍需单独部署认证和数据库，未经安全验证不要把开发中的管理员 API 暴露给公众。
