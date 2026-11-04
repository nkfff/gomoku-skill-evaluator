import {CELLS, winLine} from "./engine.js";

export const DEFAULT_TIME_CONTROL_MS = 10 * 60 * 1000;
export const INITIAL_RATING = 1000;
export const ELO_K = 32;
export const PVP_COLORS = Object.freeze({BLACK: 1, WHITE: 2});

export function createMatchState({
  roomId, matchId, blackPlayerId, whitePlayerId,
  timeControlMs = DEFAULT_TIME_CONTROL_MS, now = Date.now(),
  blackRating = INITIAL_RATING, whiteRating = INITIAL_RATING, diceRolls = [], diceWinnerPlayerId = blackPlayerId
}) {
  if (!roomId || !matchId || !blackPlayerId || !whitePlayerId || blackPlayerId === whitePlayerId) {
    throw new Error("INVALID_MATCH_PLAYERS");
  }
  if (!Number.isInteger(timeControlMs) || timeControlMs <= 0) throw new Error("INVALID_TIME_CONTROL");
  return {
    roomId, matchId, status: "active",
    blackPlayerId, whitePlayerId,
    colorByPlayer: {[blackPlayerId]: PVP_COLORS.BLACK, [whitePlayerId]: PVP_COLORS.WHITE},
    playerByColor: {[PVP_COLORS.BLACK]: blackPlayerId, [PVP_COLORS.WHITE]: whitePlayerId},
    board: Array(CELLS).fill(0),
    moves: [],
    turnPlayerId: blackPlayerId,
    turnColor: PVP_COLORS.BLACK,
    clocksMs: {black: timeControlMs, white: timeControlMs},
    turnStartedAt: now,
    lastMoveAt: null,
    startedAt: now,
    endedAt: null,
    revision: 0,
    result: null,
    winnerPlayerId: null,
    endReason: null,
    rated: true,
    initialRatings: {[blackPlayerId]: blackRating, [whitePlayerId]: whiteRating},
    diceRolls, diceWinnerPlayerId,
    finalRatings: null,
    pendingDrawBy: null
  };
}

export function applyPvpMove(state, {playerId, cellIndex, actionId, now = Date.now()}) {
  if (!state || state.status !== "active") throw new Error("MATCH_NOT_ACTIVE");
  if (playerId !== state.turnPlayerId) throw new Error("NOT_YOUR_TURN");
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= CELLS) throw new Error("INVALID_CELL");
  if (state.board[cellIndex] !== 0) throw new Error("CELL_OCCUPIED");
  const color = state.colorByPlayer[playerId];
  if (color !== state.turnColor) throw new Error("INVALID_TURN_STATE");
  const clockKey = color === PVP_COLORS.BLACK ? "black" : "white";
  const thinkMs = Math.max(0, Math.floor(now - state.turnStartedAt));
  if (thinkMs >= state.clocksMs[clockKey]) throw new Error("CLOCK_EXPIRED");

  const board = state.board.slice();
  board[cellIndex] = color;
  const clocksMs = {...state.clocksMs, [clockKey]: state.clocksMs[clockKey] - thinkMs};
  const move = {
    ply: state.moves.length + 1,
    playerId, color, cellIndex,
    playedAt: now,
    thinkMs,
    revision: state.revision + 1,
    clientActionId: String(actionId || "")
  };
  const moves = state.moves.concat(move);
  const next = {
    ...state,
    board, clocksMs, moves,
    revision: state.revision + 1,
    lastMoveAt: now,
    pendingDrawBy: null
  };
  const line = winLine(board, cellIndex, color);
  if (line.length) {
    next.status = "finished";
    next.result = color === PVP_COLORS.BLACK ? "black_win" : "white_win";
    next.winnerPlayerId = playerId;
    next.endReason = "five_in_row";
    next.endedAt = now;
    next.turnPlayerId = null;
    next.turnColor = null;
  } else if (moves.length >= CELLS) {
    next.status = "finished";
    next.result = "draw";
    next.winnerPlayerId = null;
    next.endReason = "board_full";
    next.endedAt = now;
    next.turnPlayerId = null;
    next.turnColor = null;
  } else {
    next.turnPlayerId = state.playerByColor[color === PVP_COLORS.BLACK ? PVP_COLORS.WHITE : PVP_COLORS.BLACK];
    next.turnColor = color === PVP_COLORS.BLACK ? PVP_COLORS.WHITE : PVP_COLORS.BLACK;
    next.turnStartedAt = now;
  }
  return {state: next, move, winningLine: line};
}

export function finishByResign(state, playerId, now = Date.now()) {
  if (!state || state.status !== "active") throw new Error("MATCH_NOT_ACTIVE");
  if (!state.colorByPlayer[playerId]) throw new Error("NOT_A_MATCH_PLAYER");
  const winnerColor = state.colorByPlayer[playerId] === PVP_COLORS.BLACK ? PVP_COLORS.WHITE : PVP_COLORS.BLACK;
  const winnerPlayerId = state.playerByColor[winnerColor];
  return {
    ...state,
    status: "finished",
    result: winnerColor === PVP_COLORS.BLACK ? "black_win" : "white_win",
    winnerPlayerId,
    endReason: "resign",
    endedAt: now,
    turnPlayerId: null,
    turnColor: null,
    pendingDrawBy: null
  };
}


export function offerPvpDraw(state, playerId) {
  if (!state || state.status !== "active") throw new Error("MATCH_NOT_ACTIVE");
  if (!state.colorByPlayer?.[playerId]) throw new Error("NOT_A_MATCH_PLAYER");
  if (state.pendingDrawBy === playerId) throw new Error("DRAW_ALREADY_OFFERED");
  if (state.pendingDrawBy) throw new Error("DRAW_ALREADY_PENDING");
  return {...state, pendingDrawBy: playerId};
}

export function acceptPvpDraw(state, playerId, now = Date.now()) {
  if (!state || state.status !== "active") throw new Error("MATCH_NOT_ACTIVE");
  if (!state.colorByPlayer?.[playerId]) throw new Error("NOT_A_MATCH_PLAYER");
  if (!state.pendingDrawBy || state.pendingDrawBy === playerId) throw new Error("NO_OPPONENT_DRAW_OFFER");
  return {
    ...state,
    status: "finished",
    result: "draw",
    winnerPlayerId: null,
    endReason: "draw_agreement",
    endedAt: now,
    turnPlayerId: null,
    turnColor: null,
    pendingDrawBy: null
  };
}

export function declinePvpDraw(state, playerId) {
  if (!state || state.status !== "active") throw new Error("MATCH_NOT_ACTIVE");
  if (!state.colorByPlayer?.[playerId]) throw new Error("NOT_A_MATCH_PLAYER");
  if (!state.pendingDrawBy || state.pendingDrawBy === playerId) throw new Error("NO_OPPONENT_DRAW_OFFER");
  return {...state, pendingDrawBy: null};
}

export function finishByTimeout(state, timedOutPlayerId, now = Date.now()) {
  if (!state || state.status !== "active") throw new Error("MATCH_NOT_ACTIVE");
  const timedOutColor = state.colorByPlayer[timedOutPlayerId];
  if (!timedOutColor) throw new Error("NOT_A_MATCH_PLAYER");
  const winnerColor = timedOutColor === PVP_COLORS.BLACK ? PVP_COLORS.WHITE : PVP_COLORS.BLACK;
  const winnerPlayerId = state.playerByColor[winnerColor];
  const clockKey = timedOutColor === PVP_COLORS.BLACK ? "black" : "white";
  return {
    ...state,
    clocksMs: {...state.clocksMs, [clockKey]: 0},
    status: "finished",
    result: winnerColor === PVP_COLORS.BLACK ? "black_win" : "white_win",
    winnerPlayerId,
    endReason: "timeout",
    endedAt: now,
    turnPlayerId: null,
    turnColor: null,
    pendingDrawBy: null
  };
}

export function calculateElo(blackRating, whiteRating, result, k = ELO_K) {
  const expectedBlack = 1 / (1 + 10 ** ((whiteRating - blackRating) / 400));
  const actualBlack = result === "black_win" ? 1 : result === "white_win" ? 0 : result === "draw" ? 0.5 : null;
  if (actualBlack === null) throw new Error("INVALID_MATCH_RESULT");
  const deltaBlack = Math.round(k * (actualBlack - expectedBlack));
  const deltaWhite = deltaBlack === 0 ? 0 : -deltaBlack;
  return {deltaBlack, deltaWhite, blackAfter: blackRating + deltaBlack, whiteAfter: whiteRating + deltaWhite};
}

export function ratingTier(rating, ratedGames = 10) {
  if (ratedGames < 10) return "定级中";
  if (rating < 800) return "新手";
  if (rating < 1000) return "青铜";
  if (rating < 1200) return "白银";
  if (rating < 1400) return "黄金";
  if (rating < 1600) return "铂金";
  if (rating < 1800) return "钻石";
  return "大师";
}

export function requestPvpRematch(room, playerId) {
  if (!room || room.status !== "finished" || !room.match || room.match.status !== "finished" ||
      !room.hostPlayerId || !room.guestPlayerId) throw new Error("ROOM_NOT_FINISHED");
  if (room.rematchRoomId || room.rematchStarting) throw new Error("REMATCH_ALREADY_STARTED");
  if (playerId !== room.hostPlayerId && playerId !== room.guestPlayerId) throw new Error("NOT_A_ROOM_MEMBER");
  const rematchByPlayer = {...(room.rematchByPlayer || {}), [playerId]: true};
  const acceptedByBoth = Boolean(rematchByPlayer[room.hostPlayerId] && rematchByPlayer[room.guestPlayerId]);
  return {
    acceptedByBoth,
    room: {
      ...room,
      status: acceptedByBoth ? "ready" : "finished",
      rematchByPlayer: acceptedByBoth ? {} : rematchByPlayer,
      readyByPlayer: acceptedByBoth
        ? {[room.hostPlayerId]: true, [room.guestPlayerId]: true}
        : (room.readyByPlayer || {})
    }
  };
}


export function declinePvpRematch(room, playerId) {
  if (!room || room.status !== "finished" || !room.match || room.match.status !== "finished" ||
      !room.hostPlayerId || !room.guestPlayerId) throw new Error("ROOM_NOT_FINISHED");
  if (room.rematchRoomId || room.rematchStarting) throw new Error("REMATCH_ALREADY_STARTED");
  if (playerId !== room.hostPlayerId && playerId !== room.guestPlayerId) throw new Error("NOT_A_ROOM_MEMBER");
  const opponentId = playerId === room.hostPlayerId ? room.guestPlayerId : room.hostPlayerId;
  const rematchByPlayer = {...(room.rematchByPlayer || {})};
  if (!rematchByPlayer[opponentId] || rematchByPlayer[playerId]) throw new Error("NO_PENDING_REMATCH_INVITE");
  delete rematchByPlayer[opponentId];
  return {...room, rematchByPlayer};
}

export function getIncomingPvpRematchInvite(room, viewerPlayerId) {
  if (!room || room.status !== "finished" || !room.match || room.match.status !== "finished") return null;
  const isHost = viewerPlayerId === room.hostPlayerId;
  const isGuest = viewerPlayerId === room.guestPlayerId;
  if (!isHost && !isGuest) return null;
  if (room.rematchStarting || room.rematchRoomId) return null;

  const rematchByPlayer = room.rematchByPlayer || {};
  if (rematchByPlayer[viewerPlayerId]) return null;
  const inviterPlayerId = isHost ? room.guestPlayerId : room.hostPlayerId;
  if (!inviterPlayerId || !rematchByPlayer[inviterPlayerId]) return null;

  return {
    inviterPlayerId,
    inviterName: (isHost ? room.guestName : room.hostName) || "好友"
  };
}

export function shouldAnimatePvpDice(match) {
  return Boolean(
    match &&
    match.status === "active" &&
    Array.isArray(match.diceRolls) &&
    match.diceRolls.length > 0 &&
    (!Array.isArray(match.moves) || match.moves.length === 0)
  );
}

export function applySpectatorMovePatch(match, message) {
  if (!match || !message || !message.move || !message.patch) return {status:"resync"};
  const patch = message.patch;
  if (patch.matchId !== match.matchId) return {status:"resync"};

  const currentRevision = Number(match.revision);
  const nextRevision = Number(patch.revision);
  if (!Number.isInteger(currentRevision) || !Number.isInteger(nextRevision)) return {status:"resync"};
  if (nextRevision <= currentRevision) return {status:"duplicate", match};
  if (nextRevision !== currentRevision + 1) return {status:"resync"};

  const move = message.move;
  if (!Array.isArray(match.board) || !Number.isInteger(move.cellIndex) ||
      move.cellIndex < 0 || move.cellIndex >= match.board.length ||
      match.board[move.cellIndex] !== 0 || ![1, 2].includes(move.color)) {
    return {status:"resync"};
  }

  const board = match.board.slice();
  board[move.cellIndex] = move.color;
  const moves = Array.isArray(match.moves) ? match.moves.concat(move) : [move];
  const {roomStatus, ...matchPatch} = patch;
  return {
    status:"applied",
    roomStatus,
    match:{...match, ...matchPatch, board, moves}
  };
}

export function publicMatchState(state, viewerPlayerId, {spectator = false} = {}) {
  if (!state) return null;
  const isPlayer = viewerPlayerId === state.blackPlayerId || viewerPlayerId === state.whitePlayerId;
  if (!isPlayer && !spectator) throw new Error("NOT_A_MATCH_PLAYER");
  return {
    roomId: state.roomId,
    matchId: state.matchId,
    status: state.status,
    blackPlayerId: state.blackPlayerId,
    whitePlayerId: state.whitePlayerId,
    board: state.board,
    moves: state.moves,
    turnPlayerId: state.turnPlayerId,
    turnColor: state.turnColor,
    clocksMs: state.clocksMs,
    turnStartedAt: state.turnStartedAt,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    revision: state.revision,
    result: state.result,
    winnerPlayerId: state.winnerPlayerId,
    endReason: state.endReason,
    rated: state.rated,
    initialRatings: state.initialRatings,
    diceRolls: state.diceRolls || [],
    diceWinnerPlayerId: state.diceWinnerPlayerId || state.blackPlayerId,
    finalRatings: state.finalRatings,
    pendingDrawBy: state.pendingDrawBy,
    viewerPlayerId: isPlayer ? viewerPlayerId : null
  };
}
