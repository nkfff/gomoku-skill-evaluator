# V2.2 预览版

在线链接：https://nkfff.github.io/gomoku-skill-evaluator/v2.2/

V2.2 包含棋盘/棋子皮肤预览、每局 3 次免费悔棋与额外付费悔棋、主动点击落子提示、逐手复盘、娱乐化小结、Supabase 账号与云端排行榜。

本轮更新：
- 排行榜按综合积分排序：不同难度 AI 获胜分别奖励 10 / 30 / 80 分；原始胜率单独展示，胜率修正分会根据平滑胜率与最多 20 局样本量加分或扣分。综合积分与可消费余额分离。
- 邮箱验证回到游戏页后，会在页面顶部显示验证结果；未自动登录时提示手动登录。
- 页面打开或新开一局不启动计时；点击“开始下棋”后才开始计时与接受落子。

前端已提交并由 GitHub Pages 部署；排行榜的新排序逻辑需要重新部署 Cloudflare Worker 后端，再完成线上回归验证。游客数据仅保存在当前浏览器，不作为云端正式成绩。

完整开发源码与部署说明：https://github.com/nkfff/gomoku-skill-evaluator/tree/feature/v2.2-accounts-customization
