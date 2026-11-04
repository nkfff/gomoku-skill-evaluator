import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chooseAI, CELLS } from "../src/engine.js";
import { validateSubmittedTimeline, isAdminUser } from "../worker/index.js";
import {
  UNDO_REQUEST_TIMEOUT_MS, acceptPvpDraw, acceptPvpUndo, applyPvpMove, applySpectatorMovePatch,
  cancelPvpUndo, createMatchState, declinePvpDraw, declinePvpUndo, expirePvpUndo,
  finishByResign, finishByTimeout, offerPvpDraw, offerPvpUndo,
  declinePvpRematch, getIncomingPvpRematchInvite, publicMatchState,
  requestPvpRematch, shouldAnimatePvpDice
} from "../src/pvp.js";
import {
  PvpRoom, getConnectedSpectators, hasOpenPlayerConnection, hasOpenSpectatorConnection, rollDice
} from "../worker/pvp-room.js";

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

test("spectator match snapshots are public but remain read-only", () => {
  const state = createMatchState({
    roomId:"room-watch", matchId:"match-watch", blackPlayerId:"host-id",
    whitePlayerId:"guest-id", now:1000
  });
  assert.throws(() => publicMatchState(state, "spectator-id"), /NOT_A_MATCH_PLAYER/);
  const spectatorView = publicMatchState(state, "spectator-id", {spectator:true});
  assert.equal(spectatorView.viewerPlayerId, null);
  assert.deepEqual(spectatorView.board, state.board);
  assert.equal(spectatorView.turnStartedAt, state.turnStartedAt);
  assert.deepEqual(spectatorView.clocksMs, state.clocksMs);
});

test("spectator move deltas update the board, move history and clocks without a full snapshot", () => {
  const initial = createMatchState({
    roomId:"room-watch", matchId:"match-watch", blackPlayerId:"host-id",
    whitePlayerId:"guest-id", now:1000
  });
  const result = applyPvpMove(initial, {
    playerId:"host-id", cellIndex:112, actionId:"watchmove0001", now:2500
  });
  const patch = {
    roomStatus:"active",
    matchId:result.state.matchId,
    status:result.state.status,
    revision:result.state.revision,
    turnPlayerId:result.state.turnPlayerId,
    turnColor:result.state.turnColor,
    turnStartedAt:result.state.turnStartedAt,
    clocksMs:result.state.clocksMs,
    pendingDrawBy:result.state.pendingDrawBy,
    result:result.state.result,
    winnerPlayerId:result.state.winnerPlayerId,
    endReason:result.state.endReason,
    endedAt:result.state.endedAt
  };
  const applied = applySpectatorMovePatch(initial, {move:result.move,patch});
  assert.equal(applied.status, "applied");
  assert.equal(applied.roomStatus, "active");
  assert.equal(applied.match.board[112], 1);
  assert.equal(applied.match.moves.length, 1);
  assert.equal(applied.match.moves[0].thinkMs, 1500);
  assert.deepEqual(applied.match.clocksMs, result.state.clocksMs);
  assert.equal(applied.match.turnPlayerId, "guest-id");

  assert.equal(applySpectatorMovePatch(applied.match, {move:result.move,patch}).status, "duplicate");
  assert.equal(applySpectatorMovePatch(initial, {move:result.move,patch:{...patch,revision:3}}).status, "resync");
  assert.equal(applySpectatorMovePatch(initial, {move:{...result.move,cellIndex:999},patch}).status, "resync");
});

test("spectator presence is deduplicated and never counted as a player connection", () => {
  const makeSocket = (readyState, attachment) => ({
    readyState, deserializeAttachment: () => attachment
  });
  const host = makeSocket(1, {playerId:"host-id"});
  const spectatorA = makeSocket(1, {playerId:"viewer-a",role:"spectator",displayName:"小猫"});
  const spectatorASecondTab = makeSocket(1, {playerId:"viewer-a",role:"spectator",displayName:"小猫"});
  const spectatorB = makeSocket(1, {playerId:"viewer-b",role:"spectator",displayName:"棋友"});
  const offline = makeSocket(3, {playerId:"viewer-c",role:"spectator",displayName:"离线观众"});
  const sockets = [host,spectatorA,spectatorASecondTab,spectatorB,offline];

  assert.deepEqual(getConnectedSpectators(sockets), [{name:"小猫"},{name:"棋友"}]);
  assert.equal(hasOpenSpectatorConnection(sockets,"viewer-a"), true);
  assert.equal(hasOpenSpectatorConnection(sockets,"viewer-a",spectatorA), true);
  assert.equal(hasOpenSpectatorConnection([host,spectatorB], "viewer-a"), false);
  assert.equal(hasOpenPlayerConnection(sockets,"host-id"), true);
  assert.equal(hasOpenPlayerConnection(sockets,"viewer-a"), false);
});

test("PVP spectator tickets are invite-code scoped and cannot acquire player privileges", () => {
  const pvpApi = readFileSync(fileURLToPath(new URL("../worker/v3.js", import.meta.url)), "utf8");
  const room = readFileSync(fileURLToPath(new URL("../worker/pvp-room.js", import.meta.url)), "utf8");
  const migration = readFileSync(fileURLToPath(new URL("../migrations/0008_pvp_spectators.sql", import.meta.url)), "utf8");
  assert.match(pvpApi, /async function createSpectatorTicket/);
  assert.match(pvpApi, /url\.pathname === "\/api\/pvp\/rooms\/spectate"/);
  assert.match(pvpApi, /t\.role='spectator'/);
  assert.match(pvpApi, /headers\.set\("x-role", row\.role/);
  assert.match(migration, /ADD COLUMN role TEXT NOT NULL DEFAULT 'player'/);
  assert.match(room, /MAX_SPECTATORS/);
  assert.match(room, /SPECTATOR_READ_ONLY/);
  assert.match(room, /type: "spectators_updated"/);
  assert.match(room, /const encodedPayloads = new Map\(\)/);
  assert.match(room, /type: "spectator_move"/);
  assert.match(room, /message\.type === "move_accepted"/);
  assert.match(room, /publicMatchState\(this\.room\.match, viewerPlayerId, \{spectator: !isPlayer\}\)/);
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

test("PVP draw offer is visible to the opponent and requires explicit acceptance", () => {
  const state = createMatchState({
    roomId:"room-draw", matchId:"match-draw", blackPlayerId:"host-id",
    whitePlayerId:"guest-id", now:1000
  });
  const offered = offerPvpDraw(state, "host-id");
  assert.equal(offered.pendingDrawBy, "host-id");
  assert.equal(publicMatchState(offered, "guest-id").pendingDrawBy, "host-id");
  assert.throws(() => offerPvpDraw(offered, "host-id"), /DRAW_ALREADY_OFFERED/);
  assert.throws(() => offerPvpDraw(offered, "guest-id"), /DRAW_ALREADY_PENDING/);
  assert.throws(() => acceptPvpDraw(offered, "host-id", 2000), /NO_OPPONENT_DRAW_OFFER/);
  const declined = declinePvpDraw(offered, "guest-id");
  assert.equal(declined.pendingDrawBy, null);
  const offeredAgain = offerPvpDraw(declined, "host-id");
  const accepted = acceptPvpDraw(offeredAgain, "guest-id", 3000);
  assert.equal(accepted.status, "finished");
  assert.equal(accepted.result, "draw");
  assert.equal(accepted.endReason, "draw_agreement");
  assert.equal(accepted.endedAt, 3000);
  assert.equal(accepted.pendingDrawBy, null);
  assert.throws(() => declinePvpDraw(offered, "stranger"), /NOT_A_MATCH_PLAYER/);
});

test("PVP undo request requires opponent consent and blocks conflicting actions", () => {
  const initial = createMatchState({
    roomId:"room-undo", matchId:"match-undo", blackPlayerId:"host-id",
    whitePlayerId:"guest-id", now:1000
  });
  assert.throws(() => offerPvpUndo(initial, "host-id", 2000), /NO_MOVE_TO_UNDO/);
  const moved = applyPvpMove(initial, {
    playerId:"host-id", cellIndex:112, actionId:"undo-move-01", now:3000
  }).state;
  const offered = offerPvpUndo(moved, "guest-id", 4000);
  assert.equal(offered.pendingUndo.requesterPlayerId, "guest-id");
  assert.equal(offered.pendingUndo.movePly, 1);
  assert.equal(offered.pendingUndo.lastMoveCellIndex, 112);
  assert.equal(moved.pendingUndo, null, "the prior state remains immutable");
  assert.equal(publicMatchState(offered, "host-id").pendingUndo.requesterPlayerId, "guest-id");
  assert.equal(publicMatchState(offered, "viewer-id", {spectator:true}).pendingUndo.requesterPlayerId, "guest-id");
  assert.throws(() => offerPvpUndo(offered, "host-id", 4500), /UNDO_ALREADY_PENDING/);
  assert.throws(() => applyPvpMove(offered, {
    playerId:"guest-id", cellIndex:113, actionId:"undo-move-02", now:4500
  }), /UNDO_ALREADY_PENDING/);
  assert.throws(() => offerPvpDraw(offered, "host-id"), /UNDO_ALREADY_PENDING/);
  assert.throws(() => acceptPvpUndo(offered, "guest-id", 5000), /CANNOT_ACCEPT_OWN_UNDO/);
  assert.throws(() => acceptPvpUndo(offered, "stranger", 5000), /NOT_A_MATCH_PLAYER/);
});

test("PVP undo acceptance restores the board, returns the turn and never refunds thinking time", () => {
  const initial = createMatchState({
    roomId:"room-undo-clock", matchId:"match-undo-clock", blackPlayerId:"host-id",
    whitePlayerId:"guest-id", now:1000
  });
  const moved = applyPvpMove(initial, {
    playerId:"host-id", cellIndex:112, actionId:"undo-clock-01", now:3000
  }).state;
  const offered = offerPvpUndo(moved, "guest-id", 4000);
  const accepted = acceptPvpUndo(offered, "host-id", 7000);

  assert.equal(accepted.status, "active");
  assert.equal(accepted.board[112], 0);
  assert.equal(accepted.moves.length, 0);
  assert.equal(accepted.turnPlayerId, "host-id");
  assert.equal(accepted.turnColor, 1);
  assert.equal(accepted.turnStartedAt, 7000);
  assert.equal(accepted.lastMoveAt, initial.startedAt);
  assert.equal(accepted.clocksMs.black, 598000, "black's original thinking time is not refunded");
  assert.equal(accepted.clocksMs.white, 596000, "white's time continues while the request is pending");
  assert.equal(accepted.revision, 2, "revision remains monotonic after undo");
  assert.equal(accepted.pendingUndo, null);
  assert.equal(offered.board[112], 1, "accepting must not mutate the prior snapshot");
});

test("PVP undo can be declined, cancelled by its requester or expired automatically", () => {
  const initial = createMatchState({
    roomId:"room-undo-actions", matchId:"match-undo-actions", blackPlayerId:"host-id",
    whitePlayerId:"guest-id", now:1000
  });
  const moved = applyPvpMove(initial, {
    playerId:"host-id", cellIndex:112, actionId:"undo-actions-01", now:3000
  }).state;
  const offered = offerPvpUndo(moved, "host-id", 4000);
  assert.throws(() => declinePvpUndo(offered, "host-id"), /CANNOT_DECLINE_OWN_UNDO/);
  assert.throws(() => cancelPvpUndo(offered, "guest-id"), /NOT_UNDO_REQUESTER/);
  assert.equal(declinePvpUndo(offered, "guest-id").pendingUndo, null);
  assert.equal(cancelPvpUndo(offered, "host-id").pendingUndo, null);
  assert.equal(expirePvpUndo(offered, 4000 + UNDO_REQUEST_TIMEOUT_MS - 1), offered);
  assert.equal(expirePvpUndo(offered, 4000 + UNDO_REQUEST_TIMEOUT_MS).pendingUndo, null);
  assert.throws(() => acceptPvpUndo(offered, "guest-id", 4000 + UNDO_REQUEST_TIMEOUT_MS), /UNDO_REQUEST_EXPIRED/);
  assert.equal(finishByResign(offered, "host-id", 5000).pendingUndo, null);
  assert.equal(finishByTimeout(offered, "guest-id", 5000).pendingUndo, null);
});

test("PVP undo acceptance respects the active player's clock and rejects stale requests", () => {
  const initial = createMatchState({
    roomId:"room-undo-expired", matchId:"match-undo-expired", blackPlayerId:"host-id",
    whitePlayerId:"guest-id", now:1000
  });
  const moved = applyPvpMove(initial, {
    playerId:"host-id", cellIndex:112, actionId:"undo-expired-01", now:3000
  }).state;
  const lowClock = {...moved, clocksMs:{...moved.clocksMs, white:1000}};
  const offered = offerPvpUndo(lowClock, "guest-id", 3000);
  assert.throws(() => acceptPvpUndo(offered, "host-id", 4000), /CLOCK_EXPIRED/);
  assert.throws(() => acceptPvpUndo({...offered, revision:offered.revision + 1}, "host-id", 3500), /STALE_UNDO_REQUEST/);
});

test("PVP Durable Object removes the final D1 move only after consent", async () => {
  const initial = createMatchState({
    roomId:"room-undo-db", matchId:"match-undo-db", blackPlayerId:"host-id",
    whitePlayerId:"guest-id", now:Date.now() - 2000
  });
  const moved = applyPvpMove(initial, {
    playerId:"host-id", cellIndex:112, actionId:"undo-db-0001", now:Date.now() - 1000
  }).state;
  const offered = offerPvpUndo(moved, "guest-id", Date.now() - 900);
  let storedRoom = null;
  const statements = [];
  const ctx = {
    storage: {
      get: async () => storedRoom,
      put: async (_key, value) => { storedRoom = value; },
      setAlarm: async () => {},
      deleteAlarm: async () => {}
    },
    getWebSockets: () => []
  };
  const env = {
    DB: {
      prepare: sql => ({sql, bind: (...args) => ({sql, args})}),
      batch: async sql => {
        statements.push(...sql);
        return [{meta:{changes:1}},{meta:{changes:1}}];
      }
    }
  };
  const room = new PvpRoom(ctx, env);
  await room.ready;
  room.room = {
    roomId:"room-undo-db", status:"active", hostPlayerId:"host-id", guestPlayerId:"guest-id",
    disconnectedAt:{}, match:offered
  };
  await room.acceptUndo("host-id");
  assert.equal(room.room.match.moves.length, 0);
  assert.equal(room.room.match.board[112], 0);
  assert.equal(room.room.match.turnPlayerId, "host-id");
  assert.match(statements[0].sql, /DELETE FROM pvp_moves/);
  assert.match(statements[1].sql, /UPDATE pvp_matches SET move_count/);
});

test("PVP resignation assigns the win to the opponent", () => {
  const state = createMatchState({
    roomId:"room-resign", matchId:"match-resign", blackPlayerId:"host-id",
    whitePlayerId:"guest-id", now:1000
  });
  const result = finishByResign(state, "host-id", 4000);
  assert.equal(result.status, "finished");
  assert.equal(result.result, "white_win");
  assert.equal(result.winnerPlayerId, "guest-id");
  assert.equal(result.endReason, "resign");
  assert.equal(result.endedAt, 4000);
  assert.equal(state.status, "active", "the previous match snapshot must remain unchanged");
});

test("PVP room reconnect remains online when an old socket closes after a new socket opens", () => {
  const closingSocket = {readyState: 3, deserializeAttachment: () => ({playerId:"host-id"})};
  const replacementSocket = {readyState: 1, deserializeAttachment: () => ({playerId:"host-id"})};
  const opponentSocket = {readyState: 1, deserializeAttachment: () => ({playerId:"guest-id"})};
  assert.equal(hasOpenPlayerConnection([closingSocket, replacementSocket, opponentSocket], "host-id", closingSocket), true);
  assert.equal(hasOpenPlayerConnection([closingSocket, opponentSocket], "host-id", closingSocket), false);
  assert.equal(hasOpenPlayerConnection([replacementSocket], "guest-id"), false);
});

test("PVP join endpoint lets either existing member resume before active-match rejection", () => {
  const pvpApi = readFileSync(fileURLToPath(new URL("../worker/v3.js", import.meta.url)), "utf8");
  const memberResume = pvpApi.indexOf("if (room.host_player_id === user.id || room.guest_player_id === user.id)");
  const activeGuard = pvpApi.indexOf("await assertNoActiveMatch(env, user.id)", memberResume);
  assert.ok(memberResume >= 0 && activeGuard > memberResume);
  assert.ok(pvpApi.includes('callRoom(env, room.id, "/internal/state", {playerId: user.id})'));
  assert.ok(pvpApi.includes("resumed: true"));
  assert.ok(pvpApi.includes('url.pathname === "/api/pvp/rooms/current"'));
  assert.ok(pvpApi.includes("invite_code_hash=?"));
  assert.ok(pvpApi.includes("ORDER BY created_at DESC LIMIT 1"));
  assert.ok(pvpApi.includes("datetime('9999-12-31 23:59:59')"));
  const joinHandler = pvpApi.slice(pvpApi.indexOf("async function joinRoom"), pvpApi.indexOf("async function createTicket"));
  assert.doesNotMatch(joinHandler, /expires_at|expiresAt/);
  const currentRoomHandler = pvpApi.slice(pvpApi.indexOf("async function currentRoom"), pvpApi.indexOf("async function leaderboard"));
  assert.match(currentRoomHandler, /status IN \('waiting','ready','active','finished'\)/);
  assert.doesNotMatch(currentRoomHandler, /expires_at/);
});

test("PVP frontend restores each signed-in player's room and does not replay revealed dice", () => {
  const pvpUi = readFileSync(fileURLToPath(new URL("../pvp-ui.js", import.meta.url)), "utf8");
  assert.match(pvpUi, /function roomSessionKey\(\)/);
  assert.match(pvpUi, /gomoku-v4-pvp-room:/);
  assert.match(pvpUi, /function saveRoomSession/);
  assert.match(pvpUi, /function restorePvpRoomOnLoad/);
  assert.match(pvpUi, /\/api\/pvp\/rooms\/current/);
  assert.match(pvpUi, /function revealDiceImmediately/);
  assert.match(pvpUi, /shouldAnimatePvpDice\(room\.match\)/);
  assert.match(pvpUi, /syncRematchInviteModal/);
  assert.match(pvpUi, /finishedRoomSyncInFlight/);
  assert.match(pvpUi, /document\.visibilityState/);
  assert.match(pvpUi, /saveRoomSession\(room\.roomId, inviteCode, match\.matchId\)/);
  assert.match(pvpUi, /clearRoomSession\(\)/);
  assert.match(pvpUi, /await waitForAuthReady\(\)/);
  assert.match(pvpUi, /gomoku:auth-changed/);
  assert.match(pvpUi, /activateGomokuTab\("pvp"\)/);
  assert.match(pvpUi, /inviteCode = code/);
  assert.match(pvpUi, /async function watchRoom/);
  assert.match(pvpUi, /spectatorMode/);
  assert.match(pvpUi, /pvpSpectatorPanel/);
  assert.match(pvpUi, /pvpThinkClock/);
  assert.match(pvpUi, /applySpectatorMovePatch/);
  assert.match(pvpUi, /if \(spectatorMode\) return;/);
  assert.match(pvpUi, /if \(!spectatorMode && roomState && roomState\.match/);
  assert.match(pvpUi, /api\("\/api\/pvp\/rooms\/spectate"/);
  const account = readFileSync(fileURLToPath(new URL("../src/account.js", import.meta.url)), "utf8");
  assert.match(account, /export function waitForAuthReady/);
  assert.match(account, /resolveAuthReady\(true\)/);
  assert.match(account, /gomoku:auth-changed/);
});

test("PVP rematch starts only after both players accept and resets readiness", () => {
  const room = {
    roomId:"room-1", status:"finished", hostPlayerId:"host-id", guestPlayerId:"guest-id",
    readyByPlayer:{}, rematchByPlayer:{}, match:{status:"finished"}
  };
  const first = requestPvpRematch(room, "host-id");
  assert.equal(first.acceptedByBoth, false);
  assert.equal(first.room.status, "finished");
  assert.deepEqual(first.room.rematchByPlayer, {"host-id":true});
  const second = requestPvpRematch(first.room, "guest-id");
  assert.equal(second.acceptedByBoth, true);
  assert.equal(second.room.status, "ready");
  assert.deepEqual(second.room.readyByPlayer, {"host-id":true,"guest-id":true});
  assert.deepEqual(second.room.rematchByPlayer, {});
  assert.equal(room.status, "finished", "the previous room snapshot must remain unchanged");
});


test("PVP rematch invitation can be declined and clears the inviter request", () => {
  const room = {
    roomId:"room-1", status:"finished", hostPlayerId:"host-id", guestPlayerId:"guest-id",
    rematchByPlayer:{"host-id":true}, match:{status:"finished"}
  };
  const declined = declinePvpRematch(room, "guest-id");
  assert.deepEqual(declined.rematchByPlayer, {});
  assert.deepEqual(room.rematchByPlayer, {"host-id":true}, "declining must not mutate the stored room snapshot");
  assert.throws(() => declinePvpRematch(room, "host-id"), /NO_PENDING_REMATCH_INVITE/);
  assert.throws(() => declinePvpRematch(room, "stranger"), /NOT_A_ROOM_MEMBER/);
  assert.throws(() => declinePvpRematch({...room,status:"active"}, "guest-id"), /ROOM_NOT_FINISHED/);
});

test("incoming rematch invitation is shown to the non-inviting player for either room role", () => {
  const base = {
    roomId:"room-1", status:"finished", hostPlayerId:"host-id", hostName:"房主昵称",
    guestPlayerId:"guest-id", guestName:"好友昵称", match:{status:"finished"},
    rematchStarting:false, rematchByPlayer:{}
  };
  const hostInvites = {...base, rematchByPlayer:{"host-id":true}};
  assert.deepEqual(getIncomingPvpRematchInvite(hostInvites, "guest-id"), {
    inviterPlayerId:"host-id", inviterName:"房主昵称"
  });
  assert.equal(getIncomingPvpRematchInvite(hostInvites, "host-id"), null);

  const guestInvites = {...base, rematchByPlayer:{"guest-id":true}};
  assert.deepEqual(getIncomingPvpRematchInvite(guestInvites, "host-id"), {
    inviterPlayerId:"guest-id", inviterName:"好友昵称"
  });
  assert.equal(getIncomingPvpRematchInvite(guestInvites, "guest-id"), null);
  assert.equal(getIncomingPvpRematchInvite(hostInvites, "stranger"), null);
  assert.equal(getIncomingPvpRematchInvite({...hostInvites,rematchStarting:true}, "guest-id"), null);
  assert.equal(getIncomingPvpRematchInvite({...hostInvites,rematchRoomId:"next-room"}, "guest-id"), null);
});

test("both players see the dice opening until the first move; reconnect after play reveals immediately", () => {
  const match = {
    status:"active", diceRolls:[{round:1,hostRoll:6,guestRoll:2}],
    moves:[]
  };
  assert.equal(shouldAnimatePvpDice(match), true);
  assert.equal(shouldAnimatePvpDice({...match,moves:[{cellIndex:112}]}), false);
  assert.equal(shouldAnimatePvpDice({...match,status:"finished"}), false);
  assert.equal(shouldAnimatePvpDice({...match,diceRolls:[]}), false);
});

test("PVP rematch rejects non-members and unfinished games", () => {
  const room = {
    status:"finished", hostPlayerId:"host-id", guestPlayerId:"guest-id",
    match:{status:"finished"}, rematchByPlayer:{}
  };
  assert.throws(() => requestPvpRematch(room, "stranger"), /NOT_A_ROOM_MEMBER/);
  assert.throws(() => requestPvpRematch({...room,status:"active"}, "host-id"), /ROOM_NOT_FINISHED/);
  assert.throws(() => requestPvpRematch({...room,match:{status:"active"}}, "host-id"), /ROOM_NOT_FINISHED/);
  assert.throws(() => requestPvpRematch({...room,rematchStarting:true}, "host-id"), /REMATCH_ALREADY_STARTED/);
});


test("PVP rooms persist while members exist and only explicit cancellation closes a waiting room", () => {
  const api = readFileSync(fileURLToPath(new URL("../worker/v3.js", import.meta.url)), "utf8");
  const room = readFileSync(fileURLToPath(new URL("../worker/pvp-room.js", import.meta.url)), "utf8");
  assert.match(api, /datetime\('9999-12-31 23:59:59'\)/);
  assert.match(api, /room\.host_player_id === user\.id \|\| room\.guest_player_id === user\.id/);
  assert.match(api, /resumed: true/);
  assert.match(api, /invite_code_hash=\? AND status IN \('waiting','ready','active','finished'\)/);
  assert.match(room, /PERMANENT_ROOM_EXPIRY_MS/);
  assert.doesNotMatch(room, /now >= this\.room\.expiresAt/);
  assert.doesNotMatch(room, /deadlines\.push\(this\.room\.expiresAt\)/);
  assert.match(room, /只有房主可以取消房间/);
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
  const css = readFileSync(fileURLToPath(new URL("../src/style.css", import.meta.url)), "utf8");
  const pvpUi = readFileSync(fileURLToPath(new URL("../pvp-ui.js", import.meta.url)), "utf8");
  const pvpRoom = readFileSync(fileURLToPath(new URL("../worker/pvp-room.js", import.meta.url)), "utf8");
  for (const id of ["firstMoveChoice","drawEasterEgg","drawEggReward","pvpDiceStage","pvpDiceLeft","pvpDiceRight","pvpRematch","pvpNewMatch","pvpResultModal","pvpResultClose","pvpResultTitle","pvpResultMessage","pvpResultRating","pvpResultContinue","pvpRematchInviteModal","pvpRematchInviteTitle","pvpRematchInviteMessage","pvpRematchInviteFrom","pvpRematchInviteAccept","pvpRematchInviteDecline","pvpUndoModal","pvpUndoTitle","pvpUndoMessage","pvpUndoAccept","pvpUndoDecline","pvpUndoCancel","pvpOfferUndo","aiPodium","pvpPodium"]) {
    assert.equal((html.match(new RegExp('id="' + id + '"' , "g")) || []).length, 1, id);
  }
  assert.match(html, /class="dice-cube show-5"/);
  assert.ok(html.indexOf('id="pvpDiceStage"') < html.indexOf('id="pvpBoard"'), "dice stage must appear before the board");
  assert.match(css, /\.pvp-board\[hidden\]\{display:none!important\}/);
  assert.match(css, /@keyframes diceRoll3d/);
  assert.match(pvpUi, /animateDiceFace/);
  assert.match(pvpUi, /switchToRematchRoom/);
  assert.match(pvpUi, /initialPvpRoom/);
  assert.match(pvpUi, /searchParams\.set\("pvpRoom"/);
  assert.match(pvpUi, /restorePvpRoomOnLoad/);
  assert.match(pvpUi, /revealDiceImmediately/);
  assert.match(pvpRoom, /rematchRoomId/);
  assert.match(pvpRoom, /rematchStarting/);
  assert.match(pvpUi, /正在创建新对局/);
  assert.match(pvpRoom, /internal\/init-rematch/);
  assert.match(pvpUi, /function showPvpResult/);
  assert.match(pvpUi, /等待对手回应/);
  assert.match(pvpUi, /syncRematchInviteModal/);
  assert.match(pvpUi, /wasRematchInviteHidden/);
  assert.match(pvpUi, /syncRematchInviteModal\(room, message\.playerId\)/);
  assert.match(pvpUi, /finishedRoomSyncInFlight/);
  assert.match(pvpUi, /pvpRematchInviteAccept"\)\.focus/);
  assert.match(pvpUi, /decline_rematch/);
  assert.match(pvpRoom, /message.type === "decline_rematch"/);
  assert.match(pvpRoom, /type: "rematch_declined", playerId, room:/);
  assert.match(css, /\.pvp-rematch-invite-modal\[hidden\]\{display:none!important\}/);
  assert.match(css, /\.pvp-undo-modal\[hidden\]\{display:none!important\}/);
  assert.match(pvpUi, /function syncUndoModal/);
  assert.match(pvpUi, /type: "accept_undo"/);
  assert.match(pvpUi, /type: "decline_undo"/);
  assert.match(pvpRoom, /type: "draw_offered", playerId, room:/);
  assert.match(pvpRoom, /type: "draw_declined", playerId, room:/);
  assert.match(pvpRoom, /type: "game_over", room:/);
  assert.match(css, /@keyframes pvpResultPop/);
  assert.match(css, /@keyframes pvpConfettiFall/);
});
