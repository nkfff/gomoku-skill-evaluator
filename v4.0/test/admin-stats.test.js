import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateCompetitiveStats } from "../worker/index.js";

const worker = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const account = readFileSync(new URL("../src/account.js", import.meta.url), "utf8");

test("管理员战绩调整自动推算输局、胜率和排行榜综合积分", () => {
  const stats = calculateCompetitiveStats({gamesPlayed:20,wins:12,draws:2,earnedPoints:400});
  assert.equal(stats.losses,6);
  assert.equal(stats.winRate,60);
  assert.equal(stats.adjustedWinRate,58);
  assert.equal(stats.rankPoints,416);
});

test("零场次不会出现 NaN，空白记录的胜率和综合积分为零", () => {
  const stats = calculateCompetitiveStats({gamesPlayed:0,wins:0,draws:0,earnedPoints:0});
  assert.equal(stats.losses,0);
  assert.equal(stats.winRate,0);
  assert.equal(stats.rankPoints,0);
});

test("拒绝不可能的胜局/平局组合及越界竞技积分", () => {
  assert.throws(()=>calculateCompetitiveStats({gamesPlayed:4,wins:3,draws:2,earnedPoints:10}),
    error=>error?.error==="胜局数与平局数之和不能超过总场次");
  assert.throws(()=>calculateCompetitiveStats({gamesPlayed:4,wins:1,draws:0,earnedPoints:-1}),
    error=>error?.error==="竞技积分必须为 0–1,000,000 的整数");
});

test("清空操作删除 AI 对局记录并通过 D1 batch 写入审计", () => {
  const start=worker.indexOf('url.pathname==="/api/admin/reset"');
  const end=worker.indexOf('}else throw invalid("路径不存在",404);',start);
  const block=worker.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(block,/DELETE FROM games WHERE player_id=\?/);
  assert.match(block,/env\.DB\.batch\(/);
  assert.match(block,/reset_ai_data/);
  assert.doesNotMatch(block,/inventory=/);
});

test("管理员页面提供战绩保存、清空反馈和排行榜刷新", () => {
  assert.match(account,/adminSaveStats/);
  assert.match(account,/管理操作失败：/);
  assert.match(account,/gomokuRefreshLeaderboard/);
  assert.match(account,/已取消清空操作/);
});
