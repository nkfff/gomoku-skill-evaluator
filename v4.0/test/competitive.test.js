import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chooseAI, CELLS } from "../src/engine.js";
import { validateSubmittedTimeline, isAdminUser } from "../worker/index.js";
import { createMatchState, publicMatchState } from "../src/pvp.js";
import { rollDice } from "../worker/pvp-room.js";

test("AI can search as either black or white", () => {
  const board = Array(CELLS).fill(0);
  for (const i of [105, 106, 107, 108]) board[i] = 1;
  const before = board.slice();
  assert.equal(chooseAI(board, "easy", {player: 1}).index, 109);
  assert.equal(chooseAI(board, "easy", {player: 2}).index, 109);
  assert.deepEqual(board, before, "AI search must not mutate the live board");
});

test("admin identity comparison is stable across UUID casing and whitespace", () => {
  const id = "a12b34cd-5678-4abc-9def-0123456789ab";
  assert.equal(isAdminUser({ADMIN_USER_ID:"  "+id.toUpperCase()+"  "},{id}), true);
  assert.equal(isAdminUser({ADMIN_USER_ID:id},{id:id.toUpperCase()}), true);
  assert.equal(isAdminUser({ADMIN_USER_ID:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},{id}), false);
  assert.equal(isAdminUser({}, {id}), false);
});

test("server rejects a white-first timeline because black must open", () => {
  assert.throws(() => validateSubmittedTimeline([{type:"move", i:112, p:2}, {type:"end", result:1}], "easy", 1, 0, 2));
});

test("server rejects an AI first move outside its candidate set", () => {
  assert.throws(() => validateSubmittedTimeline([{type:"move", i:0, p:1}, {type:"end", result:2}], "easy", 2, 0, 2));
});

test("PVP dice reroll ties and award black to the higher roll", () => {
  const result = rollDice("host-id", "guest-id");
  assert.ok(result.rolls.length >= 1);
  for (const round of result.rolls.slice(0, -1)) assert.equal(round.hostRoll, round.guestRoll);
  const last = result.rolls.at(-1);
  assert.notEqual(last.hostRoll, last.guestRoll);
  assert.equal(result.winnerPlayerId, last.hostRoll > last.guestRoll ? "host-id" : "guest-id");
});

test("both PVP clients receive the same auditable dice result", () => {
  const diceRolls = [{round:1, hostRoll:6, guestRoll:2}];
  const state = createMatchState({roomId:"room-1", matchId:"match-1", blackPlayerId:"host-id", whitePlayerId:"guest-id", now:Date.now(), diceRolls, diceWinnerPlayerId:"host-id"});
  const hostView = publicMatchState(state, "host-id");
  const guestView = publicMatchState(state, "guest-id");
  assert.deepEqual(hostView.diceRolls, diceRolls);
  assert.deepEqual(guestView.diceRolls, diceRolls);
  assert.equal(hostView.diceWinnerPlayerId, "host-id");
  assert.equal(guestView.diceWinnerPlayerId, "host-id");
});

test("same-user token refresh does not unconditionally hide the admin panel", () => {
  const account = readFileSync(fileURLToPath(new URL("../src/account.js", import.meta.url)), "utf8");
  assert.match(account, /if\(!signedIn\|\|resetAdmin\)\$\("adminPanel"\)\.hidden=true/);
  assert.match(account, /showState\(\{resetAdmin:identityChanged\|\|!nextUserId\}\)/);
  assert.match(account, /if\(!identityChanged\)return/);
});

test("skin collection cards use board-theme tokens and readable semantic labels", () => {
  const app = readFileSync(fileURLToPath(new URL("../src/app.js", import.meta.url)), "utf8");
  const css = readFileSync(fileURLToPath(new URL("../src/style.css", import.meta.url)), "utf8");
  assert.match(app, /class='skin-name'/);
  assert.match(app, /class='skin-meta'/);
  assert.match(app, /is-selected/);
  assert.match(css, /body\[data-board-theme\] \.skin\{[\s\S]*?var\(--surface-2\)/);
  assert.match(css, /\.skin \.skin-name\{[\s\S]*?var\(--heading\)/);
});

test("V4.0 HTML contains the new interaction surfaces exactly once", () => {
  const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
  for (const id of ["firstMoveChoice","drawEasterEgg","drawEggReward","pvpDiceStage","pvpDiceLeft","pvpDiceRight","aiPodium","pvpPodium"]) {
    assert.equal((html.match(new RegExp('id="' + id + '"' , "g")) || []).length, 1, id);
  }
});
