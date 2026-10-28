# V2.3 预览版说明

V2.3 是在 V2.2 稳定版基础上的独立预览目录。V2.2 原目录保持不变。

## 本版更新

- 本地即时落子和本地 AI 行棋；对局期间不再逐手等待 Worker 响应。
- 登录用户对局结束后提交精简事件流，服务端校验棋谱合法性、AI 候选应手、胜负和悔棋次数后结算积分。
- 成绩先进入浏览器本地待同步队列；网络恢复或点击“重试上传”后可再次提交。
- 新增猫咪咖啡馆棋盘、猫猫头棋子、落子音效开关和柔和的粉色动漫主题。
- 游客数据继续保存在本地；只有服务端成功验证的登录对局才更新云端排行榜。

## 发布状态

- **Cloudflare Worker 后端：已部署。** [部署记录](https://github.com/nkfff/gomoku-skill-evaluator/actions/runs/40670158103)
- **自动化检查：已通过。** [最新测试记录](https://github.com/nkfff/gomoku-skill-evaluator/actions/runs/40670158258)
- **前端：已发布至 GitHub Pages 的 `/v2.3/` 路径。** [最新发布与部署记录](https://github.com/nkfff/gomoku-skill-evaluator/actions/runs/40670508182)

## 发布后验收

1. 打开 `https://nkfff.github.io/gomoku-skill-evaluator/v2.3/`，检查猫猫棋盘、猫头棋子、试穿/装备和落子音效。
2. 验证游客本地对局、登录账号对局、胜负积分结算和排行榜。
3. 检查断网后成绩进入待同步队列，恢复网络后只结算一次。
4. 验证 V2.2 稳定入口 `/v2.2/` 仍然可用。

**验收边界：** 自动化测试、D1 migration、Worker 线上 health check 和 GitHub Pages 发布均已通过；但三档 AI 完整对局、胜负积分、断网恢复/重复结算及移动端布局仍需真实浏览器人工验收。V2.2 稳定入口保持不变。
