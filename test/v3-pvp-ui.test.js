import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ui = readFileSync(new URL("../v3.0/pvp-ui.js", import.meta.url), "utf8");
const config = readFileSync(new URL("../config.js", import.meta.url), "utf8");

test("V3 PVP is integrated into the cat-themed main page", () => {
  for (const id of ["tab-pvp", "panel-pvp", "pvpBoard", "pvpCreateRoom", "pvpJoinRoom", "pvpInviteCode", "pvpReady", "pvpResign", "pvpRankRows", "pvpHistoryRows"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing " + id);
  }
  assert.ok(html.includes('src="./v3.0/pvp-ui.js"'));
  assert.ok(html.includes("soundToggle"));
  assert.ok(html.includes("V3.0"));
});

test("PVP client targets the deployed Worker and uses server-authoritative moves", () => {
  assert.ok(config.includes('window.GOMOKU_PVP_API_URL = "https://gomoku-v3-api.1395598907.workers.dev";'));
  assert.ok(ui.includes('"/api/pvp/rooms"'));
  assert.ok(ui.includes('"/api/pvp/rooms/join"'));
  assert.ok(ui.includes("revision: match.revision"));
  assert.ok(ui.includes('type: "ready"'));
  assert.ok(ui.includes('type: "resign"'));
  assert.ok(ui.includes('type: "accept_draw"'));
  assert.ok(!ui.includes("renderRoom(result.room);"), "join response must be normalized by the server before rendering");
});
