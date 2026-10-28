import {CELLS, winLine} from "./engine.js";

export const DEFAULT_TIME_CONTROL_MS = 10 * 60 * 1000;
export const INITIAL_RATING = 1000;
export const ELO_K = 32;
export const PVP_COLORS = Object.freeze({BLACK: 1, WHITE: 2});

export function createMatchState({
  roomId, matchId, blackPlayerId, whitePlayerId,
  timeControlMs = DEFAULT_TIME_CONTROL_MS, now = Date.now(),
  blackRating = INITIAL_RATING, whiteRating = INITIAL_RATING
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

export function publicMatchState(state, viewerPlayerId) {
  if (!state) return null;
  const isPlayer = viewerPlayerId === state.blackPlayerId || viewerPlayerId === state.whitePlayerId;
  if (!isPlayer) throw new Error("NOT_A_MATCH_PLAYER");
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
    finalRatings: state.finalRatings,
    pendingDrawBy: state.pendingDrawBy,
    viewerPlayerId
  };
}
