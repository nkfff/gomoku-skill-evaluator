import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ANALYSIS_VERSION, summarizeQuality } from "../src/assessment.js";

function makeQuality({accuracy, severe, top1, top3}) {
  return {
    version: ANALYSIS_VERSION,
    evaluable: true,
    weight: 1,
    accuracy,
    severe,
    top1,
    top3,
    opportunity: null,
    opportunityCorrect: null,
    complexity: "低"
  };
}

const moves = [
  {p:1, seconds:1, quality:makeQuality({accuracy:100,severe:false,top1:true,top3:true})},
  {p:2, seconds:30, quality:makeQuality({accuracy:0,severe:true,top1:false,top3:false})}
];

test("棋力评估只统计玩家执黑时的黑棋着法", () => {
  const stats = summarizeQuality(moves, 1);
  assert.equal(stats.total, 1);
  assert.equal(stats.ready, 1);
  assert.equal(stats.scored, 1);
  assert.equal(stats.score, 100);
  assert.equal(stats.avgTime, 1);
  assert.equal(stats.top1, 1);
  assert.equal(stats.severeRate, 0);
});

test("棋力评估只统计玩家执白时的白棋着法", () => {
  const stats = summarizeQuality(moves, 2);
  assert.equal(stats.total, 1);
  assert.equal(stats.ready, 1);
  assert.equal(stats.scored, 1);
  assert.equal(stats.score, 0);
  assert.equal(stats.avgTime, 30);
  assert.equal(stats.top1, 0);
  assert.equal(stats.severeRate, 1);
});

test("未传入颜色时保留旧版默认执黑行为", () => {
  const stats = summarizeQuality(moves);
  assert.equal(stats.total, 1);
  assert.equal(stats.avgTime, 1);
  assert.equal(stats.score, 100);
});

test("拒绝无效的玩家棋子颜色", () => {
  assert.throws(() => summarizeQuality(moves, 0), /Invalid human color/);
  assert.throws(() => summarizeQuality(moves, 3), /Invalid human color/);
});

test("实时评分和棋谱导出都显式传入玩家颜色", () => {
  const app = readFileSync(fileURLToPath(new URL("../src/app.js", import.meta.url)), "utf8");
  const call = "summarizeQuality(game.moves,game.humanColor)";
  assert.equal(app.split(call).length - 1, 2);
});
