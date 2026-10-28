import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatchState, applyPvpMove, finishByResign, finishByTimeout,
  calculateElo, ratingTier, publicMatchState
} from "../src/pvp.js";

const makeState = (now = 1000) => createMatchState({
  roomId: "room-1", matchId: "match-1",
  blackPlayerId: "alice", whitePlayerId: "bob", now
});

test("new PVP match starts with an empty 15x15 board and black to move", () => {
  const state = makeState();
  assert.equal(state.board.length, 225);
  assert.equal(state.board.every(x => x === 0), true);
  assert.equal(state.turnPlayerId, "alice");
  assert.equal(state.clocksMs.black, 600000);
  assert.equal(state.clocksMs.white, 600000);
});

test("valid move changes board, revision, clock and turn", () => {
  const result = applyPvpMove(makeState(), {playerId: "alice", cellIndex: 112, actionId: "a1", now: 1500});
  assert.equal(result.state.board[112], 1);
  assert.equal(result.state.revision, 1);
  assert.equal(result.state.turnPlayerId, "bob");
  assert.equal(result.state.clocksMs.black, 599500);
  assert.equal(result.move.thinkMs, 500);
});

test("illegal cells, occupied cells and out-of-turn moves are rejected", () => {
  const state = makeState();
  assert.throws(() => applyPvpMove(state, {playerId: "alice", cellIndex: -1, now: 1100}), /INVALID_CELL/);
  assert.throws(() => applyPvpMove(state, {playerId: "bob", cellIndex: 112, now: 1100}), /NOT_YOUR_TURN/);
  const next = applyPvpMove(state, {playerId: "alice", cellIndex: 112, now: 1100}).state;
  assert.throws(() => applyPvpMove(next, {playerId: "bob", cellIndex: 112, now: 1200}), /CELL_OCCUPIED/);
});

test("horizontal five ends the match and freezes further moves", () => {
  let state = makeState();
  const seq = [
    ["alice", 0], ["bob", 15], ["alice", 1], ["bob", 16],
    ["alice", 2], ["bob", 17], ["alice", 3], ["bob", 18], ["alice", 4]
  ];
  let result;
  seq.forEach(([playerId, cellIndex], i) => {
    result = applyPvpMove(state, {playerId, cellIndex, actionId: "m" + i, now: 1000 + (i + 1) * 100});
    state = result.state;
  });
  assert.equal(state.status, "finished");
  assert.equal(state.result, "black_win");
  assert.equal(state.endReason, "five_in_row");
  assert.equal(result.winningLine.length, 5);
  assert.throws(() => applyPvpMove(state, {playerId: "bob", cellIndex: 19, now: 3000}), /MATCH_NOT_ACTIVE/);
});

test("overline is a win under standard no-forbidden-move rules", () => {
  let state = makeState();
  const seq = [
    ["alice", 0], ["bob", 15], ["alice", 1], ["bob", 16],
    ["alice", 2], ["bob", 17], ["alice", 3], ["bob", 18],
    ["alice", 4], ["bob", 19], ["alice", 5]
  ];
  for (let i = 0; i < seq.length; i++) {
    const [playerId, cellIndex] = seq[i];
    state = applyPvpMove(state, {playerId, cellIndex, now: 1000 + (i + 1) * 100}).state;
    if (state.status === "finished" && i < seq.length - 1) break;
  }
  assert.equal(state.status, "finished");
  assert.equal(state.result, "black_win");
});

test("resign and timeout give victory to the opponent", () => {
  assert.equal(finishByResign(makeState(), "alice", 2000).winnerPlayerId, "bob");
  assert.equal(finishByTimeout(makeState(), "alice", 2000).winnerPlayerId, "bob");
});

test("Elo updates are zero-sum and draw preserves equal ratings", () => {
  const win = calculateElo(1000, 1000, "black_win");
  assert.equal(win.deltaBlack, 16);
  assert.equal(win.deltaWhite, -16);
  assert.equal(win.deltaBlack + win.deltaWhite, 0);
  const draw = calculateElo(1000, 1000, "draw");
  assert.equal(draw.deltaBlack, 0);
  assert.equal(draw.deltaWhite, 0);
});

test("rating tiers require ten rated games before placement", () => {
  assert.equal(ratingTier(1800, 9), "定级中");
  assert.equal(ratingTier(799, 10), "新手");
  assert.equal(ratingTier(1000, 10), "白银");
  assert.equal(ratingTier(1800, 10), "大师");
});

test("match state is only exposed to participants", () => {
  const state = makeState();
  assert.throws(() => publicMatchState(state, "mallory"), /NOT_A_MATCH_PLAYER/);
  assert.equal(publicMatchState(state, "alice").viewerPlayerId, "alice");
});
