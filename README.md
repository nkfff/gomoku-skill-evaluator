# 五子棋棋力评估 V2（开发分支）

> **当前稳定线上版本仍为 V1（main）。V2 位于 feature/v2-major-upgrade，尚未上线。**

- V1 在线版：https://nkfff.github.io/gomoku-skill-evaluator/
- V2 开发分支：https://github.com/nkfff/gomoku-skill-evaluator/tree/feature/v2-major-upgrade

## V2 已实现（开发预览）

| 模块 | V2 功能 | 状态 |
| --- | --- | --- |
| 复盘 | 玩家和 AI 每手落点、耗时、推荐候选，任意步快进/快退 | 开发完成，待浏览器验收 |
| 终局计时 | 结束时记录固定时间，之后不继续增长 | 开发完成，待验收 |
| 终局悔棋 | 终局禁用悔棋（无法通过悔棋修改结算） | 开发完成，待验收 |
| 三档难度 | 新手、进阶、大师，使用启发式与有限 Alpha-Beta 搜索 | 开发完成，待引擎基准测试 |
| 皮肤商店 | 五套棋盘及配套棋子配色，兑换成本 0/60/150/260/500 | 本地可用；云端需部署 |
| 胜局积分 | 新手 +10、进阶 +30、大师 +80 | 本地可用；云端需部署 |
| 排行榜 | D1 存储玩家总积分和胜负数，排名前 30 | **服务端代码已写，尚未部署** |
| 玩家标识 | 浏览器内生成 UUID，跨对局持久保存 | 本地/云端都能使用 |

注意：启发式复盘提示不等于经过专业求解器认证的最佳着；“大师”难度也不是职业段位水平。

## 本地运行

项目使用 ES modules，需要通过本地 HTTP 服务（不能仅双击 V2 的 index.html）：

~~~bash
python3 -m http.server 8080
# 浏览器访问 http://localhost:8080/
~~~

V2 默认使用本地模式，不依赖服务器。积分、昵称和已购皮肤保存在 localStorage，不能充当可信全球排行榜积分；刷新页面仍能保留这些资料，但更换浏览器或清理数据后可能丢失。

## 多人排行榜部署（Cloudflare Workers + D1）

GitHub Pages 是静态托管，不能独立实现跨用户排行榜。因此服务端位于 \`worker/index.js\`，使用 D1 数据库处理服务器对局、积分、兑换和排行榜。

部署时需拥有 Cloudflare 账号，且可能产生相应服务使用费（视额度和访问量而定）。

1. 安装依赖：\`npm install\`
2. 登录：\`npx wrangler login\`
3. 创建 D1 数据库：\`npx wrangler d1 create gomoku-v2\`
4. 把输出的真实 \`database_id\` 填到 \`wrangler.toml\`（替换占位字符串）。
5. 执行迁移：\`npx wrangler d1 migrations apply gomoku-v2 --remote\`
6. 部署 Worker：\`npx wrangler deploy\`
7. 将 Worker 地址写入 \`config.js\`，例如：
   \`window.GOMOKU_API_URL = "https://gomoku-v2-api.<your-subdomain>.workers.dev";\`
8. 将本分支发布到独立预览环境（不要直接覆盖 main）以便测试。

Worker 必须限制前端 Origin（当前为 \`https://nkfff.github.io\`），不应当开放任意来源的写入；在公开上线前还应增加速率限制、滥用监控和强身份验证。

### API

- \`GET /api/health\`
- \`GET /api/leaderboard\`
- \`POST /api/profile\`
- \`POST /api/name\`
- \`POST /api/start\`
- \`POST /api/move\`（AI 决策在服务端，胜负也在服务端判定）
- \`POST /api/shop\`

**云端模式下禁用悔棋**，避免本地撤销与服务端已结算对局分歧；若要实现云端悔棋，需要增加服务端撤销协议和明确的积分结算规则。

### 身份与 IP 的说明

不能把 IP 当成“唯一玩家 ID”：
- 同一 Wi-Fi / 公司 / 校园网可能有多位玩家共享公网 IP。
- 一位玩家的 IP 可能变化（移动网络、VPN、IPv6 等）。
- IP 是个人数据，直接保存、展示 IP 会带来隐私和合规风险。

本版使用浏览器 localStorage 中持久匿名 UUID 来归并同一浏览器的多局战绩。它不能识别清除浏览数据后的同一人，也不能保证跨设备身份一致。**云端 UUID 仍属于轻量身份，不能防恶意伪造；公开积分排名上线前推荐用 OAuth/Passkey/账号登录，服务端绑定凭据，并加入限流与风控。** 当前后端不保存原始 IP，也不把 IP 显示在排行榜里。

## 测试

~~~bash
npm test
~~~

测试涵盖五连判断、直接取胜/防守、开局候选、复盘状态重建与非法重复落子。还需要实机检查浏览器交互和云端接口部署。

## 文件

~~~text
index.html                 V2 主页面
config.js                  API 地址配置（空为本地模式）
src/style.css              界面皮肤与响应式样式
src/app.js                 对弈、复盘、商店和云端连接
src/engine.js              纯棋局逻辑和 AI
worker/index.js            Cloudflare Worker 排行榜/对局后端
migrations/0001_init.sql   D1 数据库结构
wrangler.toml              Worker 部署配置
test/engine.test.js        Node 引擎测试
~~~

## 合并建议

先完成测试与云端防作弊增强，在独立 V2 预览站点验收后，再向 \`main\` 发 PR。不要用本地可修改的积分直接同步到云端排名。


## V2 搜索评估升级

每手落子由独立 Web Worker 在后台进行**候选着法 + 对方最佳回应**的有限两层搜索，报告双方的推荐着、搜索排名、Top-1 / Top-3、落子损失（优势分差）与严重失误标记。当前每次最多评估 9 个优先候选，始终包含实际落子；如果候选集合不完整，排名是**被搜索候选中的排名**，并不是全盘全部合法位置排名。

综合分采用玩家已评估着法的比例，避免通过下很长的棋局无限累加：
`score = round(0.55 × 平均单步准确度 + 20 × Top1率 + 10 × Top3率 + 15 × (1 − 严重失误率))`，限制到 0–100 分。
单步准确度：`clamp(round(100 − 1.2 × 落子损失), 0, 100)`。
落子损失是自定义启发式优势分差（0–200），**不是国际象棋式厘兵分值，也不是胜率**。直胜点、漏杀和漏防优先标注；其余损失达到 55 为“严重失误（搜索估计）”，达到 25 为“明显偏差”，达到 8 为“小幅偏差”。未完成后台分析时不输出最终综合分。

现阶段这是**小深度估计器**，不是专业五子棋求解器；不能保证识别完整 VCF/VCT。评分未纳入对手强度和悔棋惩罚，思考时间单独呈现，不能把 100 分当成真实段位。
