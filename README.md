# 五子棋棋力评估 · Gomoku Skill Evaluator

**一个可以在线游玩、记录思考时间和导出棋谱的五子棋小游戏。**  
A browser-based Gomoku game with move timing, undo tracking and a lightweight skill report.

### 🎮 在线体验

**[立即开始下棋 → https://nkfff.github.io/gomoku-skill-evaluator/](https://nkfff.github.io/gomoku-skill-evaluator/)**

- [查看源代码](https://github.com/nkfff/gomoku-skill-evaluator/blob/main/index.html)
- [查看 GitHub Pages 部署记录](https://github.com/nkfff/gomoku-skill-evaluator/actions/workflows/pages/pages-build-deployment)

> 站点通过 GitHub Pages 发布。若刚修改了 Pages 设置或提交代码，网页可能需要短暂同步；以仓库的 Actions 部署结果和实际网页可访问性为准。

## 功能

| 功能 | 说明 |
| --- | --- |
| 🏁 五子棋对战 | 15 × 15 棋盘，玩家黑棋先手，AI 白棋后手；自由规则（不设禁手） |
| ⏱️ 落子计时 | 记录每手思考秒数、落子位置及对局时长 |
| ↩️ 悔棋记录 | 支持悔棋并累计悔棋次数，导出事件日志保留悔棋痕迹 |
| 🔎 棋形提示 | 基于启发式规则识别直接成五、漏防及部分活三、冲四、活四棋形 |
| 📊 棋力参考报告 | 汇总思考时间、失误、关键防守和棋形事件，生成 0–100 的内部参考分 |
| 💾 JSON 导出 | 导出当前有效棋谱及操作事件，可用于之后进一步复盘 |
| 🔒 本地隐私 | 游戏逻辑在浏览器内执行，不需要注册账号，也不会自动上传棋谱 |

## 开始使用

**在线游玩：** 打开 [GitHub Pages 游戏网址](https://nkfff.github.io/gomoku-skill-evaluator/)，点击棋盘交叉点下黑棋，电脑会自动应招。

**离线游玩：** 下载仓库根目录的 [`index.html`](./index.html)，双击使用现代浏览器打开，无需安装依赖、启动后端或运行构建命令。

**查看测评：** 对局过程中或结束后点击“生成报告”。“复制报告”可复制文字，“导出 JSON”可保存完整记录用于复盘。

**悔棋：** 会撤销最近一轮已完成的黑白落子；如果 AI 尚未落子，则只撤销刚下的黑棋。悔棋次数保留在本局统计中。

## 棋谱数据

导出的 `gomoku-evaluation.json` 包含：

- `moves`：当前有效的落子序列，每手含棋手、坐标、思考时间、启发式评语及时间戳。
- `events`：按时间记录落子、悔棋和终局事件（撤销前的着法也可以在这里找到）。
- `undoCount`、`outcome`：悔棋累计次数和结果。
- `report`：生成时的棋力参考报告。

> 页面刷新或关闭后，未导出的本局数据不会自动恢复；需要留档请先导出 JSON。

## 棋力评分的边界

**请勿把报告的分数当作专业五子棋棋力等级。**

- 当前 AI 采用**直接胜点检测、必防检测和启发式棋形评分**，没有完整 Minimax / Alpha-Beta 搜索，也没有验证过的 VCF/VCT 完整杀棋搜索。
- 报告基于部分局面模式和行为统计。所谓“最佳着排名”只来自启发式评分，并非经过深层搜索证明的最优着。
- 0–100 分只适合同一版本、类似难度对局中的娱乐性对比，**不能换算 Elo、业余段位，也不能仅凭思考时间或悔棋次数断定水平**。
- 默认自由规则：先连成五子或以上即获胜，未实现标准竞赛中的禁手、开局交换等规则。

## 项目结构

```text
gomoku-skill-evaluator/
├── index.html    # HTML + CSS + JavaScript，完整游戏
├── README.md     # 使用及技术说明
└── .nojekyll     # GitHub Pages 直接发布静态文件
```


## 后续改进方向

提高 AI 搜索深度、增加更严格的棋形检测与对局复盘、支持本地存档，以及开展有基准数据的棋力评估。
