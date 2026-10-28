import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const html = readFileSync(new URL("../v3.0/index.html", import.meta.url), "utf8");
const ui = readFileSync(new URL("../v3.0/pvp-ui.js", import.meta.url), "utf8");
const config = readFileSync(new URL("../v3.0/config.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../worker/v3.js", import.meta.url), "utf8");
const room = readFileSync(new URL("../worker/pvp-room.js", import.meta.url), "utf8");
const schema = readFileSync(new URL("../migrations/0003_pvp.sql", import.meta.url), "utf8");

test("V3 page has a dedicated PVP tab, board and room controls", () => {
  for (const id of [
    "tab-pvp", "panel-pvp", "pvpBoard", "pvpCreateRoom", "pvpJoinRoom",
    "pvpInviteCode", "pvpReady", "pvpResign", "pvpRankRows", "pvpHistoryRows"
  ]) assert.ok(html.includes('id="' + id + '"'), "missing " + id);
  assert.ok(html.includes('src="../src/app.js"'));
  assert.ok(html.includes('src="./pvp-ui.js"'));
});

test("PVP browser code uses server-authenticated room APIs and revisioned moves", () => {
  assert.ok(ui.includes('"/api/pvp/rooms"'));
  assert.ok(ui.includes('"/api/pvp/rooms/join"'));
  assert.ok(ui.includes('revision: match.revision'));
  assert.ok(ui.includes('type: "ready"'));
  assert.ok(ui.includes('type: "resign"'));
  assert.ok(ui.includes('type: "accept_draw"'));
});

test("V3 config keeps V2 account API separate from PVP API", () => {
  assert.ok(config.includes("GOMOKU_API_URL"));
  assert.ok(config.includes("GOMOKU_PVP_API_URL"));
  assert.ok(config.includes("GOMOKU_SUPABASE_PUBLISHABLE_KEY"));
});

test("PVP API validates Supabase JWT and only issues short-lived one-use WebSocket tickets", () => {
  assert.ok(worker.includes("jwtVerify"));
  assert.ok(worker.includes("expires_at>datetime('now')"));
  assert.ok(worker.includes("consumed_at IS NULL"));
  assert.ok(worker.includes("datetime('now','+45 seconds')"));
});

test("room service validates turn and revision and persists rating events idempotently", () => {
  assert.ok(room.includes("applyPvpMove"));
  assert.ok(room.includes("STALE_REVISION"));
  assert.ok(schema.includes("UNIQUE(match_id, player_id)"));
  assert.ok(room.includes("INSERT OR IGNORE INTO pvp_rating_events"));
  assert.ok(room.includes("settlementPending"));
});
