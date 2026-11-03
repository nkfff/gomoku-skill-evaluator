import {bearer, loggedIn, waitForAuthReady} from "./src/account.js";

const $ = id => document.getElementById(id);
const API = String(window.GOMOKU_PVP_API_URL || "").replace(/\/$/, "");
const DEFAULT_CLOCK_MS = 600000;
let roomId = "";
let inviteCode = "";
let playerId = "";
let roomState = null;
let diceAnimationMatchId = "";
let diceAnimationComplete = false;
let diceAnimationRunId = 0;
let pvpResultMatchId = "";
let socket = null;
let reconnectTimer = null;
let intentionalClose = false;

function notice(text, bad = false) {
  const node = $("pvpNotice");
  if (!node) return;
  node.textContent = text;
  node.style.borderColor = bad ? "#b95a52" : "#6886ba";
}

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function playerFromToken(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).sub || "";
  } catch { return ""; }
}

async function tokenOrThrow() {
  // Supabase is loaded asynchronously by the account module. Wait for its
  // initial getSession() before deciding that this browser is signed out.
  await waitForAuthReady();
  const token = await bearer();
  if (!token || !loggedIn()) {
    $("pvpAuthRequired").hidden = false;
    throw new Error("当前未检测到有效登录，请先在「账号 / 管理」完成登录；登录后会自动恢复房间。");
  }
  $("pvpAuthRequired").hidden = true;
  const nextPlayerId = playerFromToken(token);
  if (playerId && playerId !== nextPlayerId) {
    intentionalClose = true;
    closeSocket();
    roomId = "";
    inviteCode = "";
    roomState = null;
    $("pvpRoom").hidden = true;
    $("pvpLobby").hidden = false;
    syncRoomUrl("", "");
  }
  playerId = nextPlayerId;
  return token;
}

function roomSessionKey() {
  return playerId ? "gomoku-v4-pvp-room:" + playerId : "";
}

function loadRoomSession() {
  if (!playerId) return null;
  try {
    const value = JSON.parse(localStorage.getItem(roomSessionKey()) || "null");
    if (!value || typeof value.roomId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.roomId)) return null;
    return value;
  } catch {
    return null;
  }
}

function saveRoomSession(id = roomId, code = inviteCode, diceMatchId) {
  if (!playerId || !id) return;
  const previous = loadRoomSession();
  const sameRoom = previous && previous.roomId === id;
  const session = {
    roomId: id,
    inviteCode: code || (sameRoom ? previous.inviteCode || "" : ""),
    diceMatchId: diceMatchId === undefined
      ? (sameRoom ? previous.diceMatchId || "" : "")
      : diceMatchId
  };
  try { localStorage.setItem(roomSessionKey(), JSON.stringify(session)); } catch {}
}

function clearRoomSession() {
  if (!playerId) return;
  try { localStorage.removeItem(roomSessionKey()); } catch {}
}

function syncRoomUrl(id = roomId, code = inviteCode) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("pvpRoom", id);
  else url.searchParams.delete("pvpRoom");
  if (code) url.searchParams.set("invite", code);
  else url.searchParams.delete("invite");
  history.replaceState(null, "", url.toString());
}

async function api(path, method = "GET", body = null, auth = true) {
  if (!API) throw new Error("V3 PVP Worker 尚未部署或尚未配置 API 地址。");
  const headers = {"Content-Type": "application/json"};
  if (auth) headers.Authorization = "Bearer " + await tokenOrThrow();
  const response = await fetch(API + path, {
    method,
    headers,
    ...(method === "POST" ? {body: JSON.stringify(body || {})} : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "PVP 服务请求失败");
    error.status = response.status;
    throw error;
  }
  return data;
}

function closeSocket() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (socket) {
    socket.onclose = null;
    socket.onerror = null;
    try { socket.close(); } catch {}
  }
  socket = null;
}

async function connectSocket(id) {
  if (!id) return;
  closeSocket();
  intentionalClose = false;
  const ticketResult = await api("/api/pvp/rooms/" + encodeURIComponent(id) + "/ticket", "POST", {});
  const wsBase = API.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const ws = new WebSocket(wsBase + "/api/pvp/rooms/" + encodeURIComponent(id) + "/ws?ticket=" + encodeURIComponent(ticketResult.ticket));
  socket = ws;
  ws.onopen = () => notice("已连接好友房间，正在同步对局状态。");
  ws.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    handleMessage(message);
  };
  ws.onerror = () => notice("实时连接出现问题，正在尝试恢复…", true);
  ws.onclose = () => {
    if (socket === ws) socket = null;
    if (!intentionalClose && roomId) {
      notice("连接中断，正在自动重连；已确认的棋盘状态不会丢失。", true);
      reconnectTimer = setTimeout(() => connectSocket(roomId).catch(error => notice(error.message, true)), 1500);
    }
  };
}

function handleMessage(message) {
  if (message.room) renderRoom(message.room);
  if (message.type === "error") {
    $("pvpRematchInviteAccept").disabled = false;
    $("pvpRematchInviteDecline").disabled = false;
    notice(message.message || "对局操作失败", true);
    if (message.code === "STALE_REVISION") refreshRoomState().catch(() => {});
  } else if (message.type === "match_started") {
    notice("双方摇骰揭晓先手！点数较大的一方执黑先行。");
  } else if (message.type === "game_over") {
    const match = message.room && message.room.match;
    const result = match ? match.result : "";
    notice(result === "draw" ? "本局已和棋，真人 Elo 已结算。" :
      match && match.winnerPlayerId === playerId ? "漂亮！你赢下了这局真人对战。" :
      "本局已结束，结果与真人 Elo 已结算。");
    if (match) showPvpResult(match, message.room);
    refreshHistory().catch(() => {});
    refreshLeaderboard().catch(() => {});
  } else if (message.type === "rematch_requested") {
    if (message.playerId === playerId) {
      notice("已发起再战邀请，等待好友同意。");
    } else {
      const room = message.room || roomState;
      const inviterName = room ? (playerId === room.hostPlayerId ? room.guestName : room.hostName) : "好友";
      notice((inviterName || "好友") + " 邀请你再来一局，请在弹窗中选择是否接受。");
    }
  } else if (message.type === "rematch_declined") {
    notice(message.playerId === playerId
      ? "已拒绝好友的再来一局邀请。"
      : "好友暂时不想再来一局，你可以稍后再次邀请。");
  } else if (message.type === "rematch_starting") {
    notice("双方已同意再战，正在创建新对局…");
  } else if (message.type === "rematch_failed") {
    notice("新对局创建失败，请再次接受再来一局。", true);
  } else if (message.type === "rematch_started") {
    notice("双方已同意再战，正在切换到新棋局…");
    switchToRematchRoom(message.newRoomId).catch(error => notice(error.message, true));
  } else if (message.type === "draw_offered") {
    notice(message.playerId === playerId
      ? "和棋请求已送达，等待对手回应。"
      : "对手提出和棋，请选择「接受和棋」或「拒绝和棋」。");
  } else if (message.type === "draw_declined") {
    notice(message.playerId === playerId
      ? "你已拒绝和棋，对局继续。"
      : "对手拒绝了和棋，继续战斗。");
  }
}

async function refreshRoomState() {
  if (!roomId) return;
  const data = await api("/api/pvp/rooms/" + encodeURIComponent(roomId));
  renderRoom(data.room || data);
}

function formatClock(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}

function currentClock(match, color) {
  let remaining = Number(match.clocksMs[color] || 0);
  const currentColor = match.turnColor === 1 ? "black" : "white";
  if (match.status === "active" && currentColor === color && match.turnStartedAt) {
    remaining -= Math.max(0, Date.now() - Number(match.turnStartedAt));
  }
  return Math.max(0, remaining);
}


function closePvpResultModal() {
  const modal = $("pvpResultModal");
  if (modal) modal.hidden = true;
}

function showPvpResult(match, room = roomState) {
  if (!match || match.status !== "finished" || !match.matchId || pvpResultMatchId === match.matchId) return;
  pvpResultMatchId = match.matchId;
  const isDraw = match.result === "draw";
  const won = !isDraw && match.winnerPlayerId === playerId;
  const opponentName = room
    ? (room.hostPlayerId === playerId ? room.guestName : room.hostName) || "对手"
    : "对手";
  const reason = match.endReason || "";
  let message = "本局已结束，真人段位分已完成结算。";
  if (reason === "resign") {
    message = won ? opponentName + " 选择认输，你获得本局胜利。" : "你选择了认输，本局判负。";
  } else if (reason === "timeout") {
    message = won ? opponentName + " 用时耗尽，你获得胜利。" : "你的剩余时间已耗尽，本局判负。";
  } else if (reason === "disconnect_timeout") {
    message = won ? opponentName + " 断线超时，你获得胜利。" : "你断线超过宽限时间，本局判负。";
  } else if (reason === "five_in_row") {
    message = won ? "你率先连成五子，赢下本局。" : opponentName + " 率先连成五子，本局失利。";
  } else if (reason === "draw_agreement") {
    message = "双方同意和棋，本局按平局规则结算。";
  } else if (reason === "board_full") {
    message = "棋盘已满，双方平局。";
  }

  const before = Number(match.initialRatings && match.initialRatings[playerId]);
  const after = Number(match.finalRatings && match.finalRatings[playerId]);
  const hasRating = Number.isFinite(before) && Number.isFinite(after);
  const delta = hasRating ? after - before : null;
  const deltaText = delta === null ? "—" : (delta > 0 ? "+" : "") + String(delta);
  const modal = $("pvpResultModal");
  modal.classList.remove("is-win", "is-loss", "is-draw");
  modal.classList.add(isDraw ? "is-draw" : won ? "is-win" : "is-loss");
  $("pvpResultIcon").textContent = isDraw ? "🤝" : won ? "🏆" : "♟";
  $("pvpResultEyebrow").textContent = isDraw ? "MATCH DRAW" : won ? "VICTORY" : "MATCH OVER";
  $("pvpResultTitle").textContent = isDraw ? "握手言和" : won ? "胜利！" : "本局失利";
  $("pvpResultMessage").textContent = message;
  $("pvpResultOutcome").textContent = isDraw ? "和棋" : won ? "胜利" : "失利";
  $("pvpResultRating").textContent = deltaText;
  modal.hidden = false;
}

function renderClock() {
  const match = roomState && roomState.match;
  if (!match) {
    $("pvpMyClock").textContent = "10:00";
    $("pvpOpponentClock").textContent = "10:00";
    return;
  }
  const myColor = match.blackPlayerId === playerId ? "black" : "white";
  const otherColor = myColor === "black" ? "white" : "black";
  $("pvpMyClock").textContent = formatClock(currentClock(match, myColor));
  $("pvpOpponentClock").textContent = formatClock(currentClock(match, otherColor));
}

const BOARD_THEMES = {
  classic: {bg:"#dcb77b", grid:"#815830"},
  jade: {bg:"#a8c8b2", grid:"#42725b"},
  night: {bg:"#24283b", grid:"#65729b"},
  cherry: {bg:"#f0c8cd", grid:"#a96a76"},
  catcafe: {bg:"#fff1f6", grid:"#c7789a", cat:true},
  gold: {bg:"#3c3131", grid:"#ac884a"}
};
const PIECE_THEMES = {
  classic: {black:"#18191e", white:"#fffdf4", ring:"#74706d"},
  crystal: {black:"#2367b3", white:"#d5faff", ring:"#86d3ff", gloss:true},
  ink: {black:"#14262c", white:"#f5e9d8", ring:"#c28d5e"},
  neon: {black:"#bb35fe", white:"#42f7ed", ring:"#f0a4ff", gloss:true},
  pearl: {black:"#2c182a", white:"#ffdcf0", ring:"#d7a0b9", gloss:true},
  cat: {black:"#30273f", white:"#fff8fc", ring:"#ee8db2", gloss:true, cat:true}
};

function currentVisualThemes() {
  let boardId = document.body.dataset.boardTheme || "";
  let pieceId = document.body.dataset.pieceTheme || "";
  if (!boardId || !pieceId) {
    try {
      const profile = JSON.parse(localStorage.getItem("gomoku-v2-local-player") || "{}");
      boardId = boardId || profile.boardSkin || profile.skin || "classic";
      pieceId = pieceId || profile.pieceSkin || "classic";
    } catch {
      boardId = boardId || "classic";
      pieceId = pieceId || "classic";
    }
  }
  return {
    board: BOARD_THEMES[boardId] || BOARD_THEMES.classic,
    piece: PIECE_THEMES[pieceId] || PIECE_THEMES.classic
  };
}

function drawPaw(ctx, x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#f2a5bf99";
  for (const [px, py, rx, ry] of [[-7,-5,3,4],[0,-8,3,4],[7,-5,3,4]]) {
    ctx.beginPath();
    ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(0, 2, 8, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCatStone(ctx, x, y, stone, piece, isLast) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-12, -5);
  ctx.lineTo(-10, -14);
  ctx.lineTo(-3, -10);
  ctx.quadraticCurveTo(0, -12, 3, -10);
  ctx.lineTo(10, -14);
  ctx.lineTo(12, -5);
  ctx.arc(0, 1, 12, -0.1, Math.PI + 0.1);
  ctx.closePath();
  ctx.fillStyle = stone === 1 ? piece.black : piece.white;
  ctx.shadowColor = "#0005";
  ctx.shadowBlur = 3;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = piece.ring;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  const eye = stone === 1 ? "#fff8fc" : "#49384d";
  ctx.fillStyle = eye;
  ctx.beginPath();
  ctx.ellipse(-4.5, -1, 1.5, 2.3, -0.12, 0, Math.PI * 2);
  ctx.ellipse(4.5, -1, 1.5, 2.3, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-1.6, 3);
  ctx.lineTo(1.6, 3);
  ctx.lineTo(0, 4.8);
  ctx.closePath();
  ctx.fillStyle = "#e982a8";
  ctx.fill();
  ctx.strokeStyle = eye;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-1, 5);
  ctx.quadraticCurveTo(-3, 7, -4, 5.5);
  ctx.moveTo(1, 5);
  ctx.quadraticCurveTo(3, 7, 4, 5.5);
  ctx.moveTo(-8, 3);
  ctx.lineTo(-12, 2);
  ctx.moveTo(-8, 5);
  ctx.lineTo(-11, 7);
  ctx.moveTo(8, 3);
  ctx.lineTo(12, 2);
  ctx.moveTo(8, 5);
  ctx.lineTo(11, 7);
  ctx.stroke();
  if (isLast) {
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, Math.PI * 2);
    ctx.strokeStyle = "#f34c42";
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }
  ctx.restore();
}

function drawBoard() {
  const canvas = $("pvpBoard");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const match = roomState && roomState.match;
  const size = canvas.width;
  const offset = 48;
  const cell = 36;
  const {board: boardSkin, piece: pieceSkin} = currentVisualThemes();
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = boardSkin.bg;
  ctx.fillRect(0, 0, size, size);
  if (boardSkin.cat) {
    drawPaw(ctx, 17, 17, 0.9);
    drawPaw(ctx, size - 17, 17, 0.9);
    drawPaw(ctx, 17, size - 17, 0.9);
    drawPaw(ctx, size - 17, size - 17, 0.9);
  }
  ctx.strokeStyle = boardSkin.grid;
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 15; k++) {
    const p = offset + cell * k;
    ctx.beginPath();
    ctx.moveTo(offset, p);
    ctx.lineTo(offset + cell * 14, p);
    ctx.moveTo(p, offset);
    ctx.lineTo(p, offset + cell * 14);
    ctx.stroke();
  }
  for (const r of [3, 7, 11]) for (const c of [3, 7, 11]) {
    ctx.beginPath();
    ctx.arc(offset + c * cell, offset + r * cell, 3, 0, Math.PI * 2);
    ctx.fillStyle = boardSkin.grid;
    ctx.fill();
  }
  if (!match) return;
  const last = match.moves && match.moves[match.moves.length - 1];
  for (let i = 0; i < match.board.length; i++) {
    const color = match.board[i];
    if (!color) continue;
    const x = offset + (i % 15) * cell;
    const y = offset + Math.floor(i / 15) * cell;
    const isLast = !!last && last.cellIndex === i;
    if (pieceSkin.cat) {
      drawCatStone(ctx, x, y, color, pieceSkin, isLast);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fillStyle = color === 1 ? pieceSkin.black : pieceSkin.white;
      ctx.shadowColor = "#0005";
      ctx.shadowBlur = 3;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = pieceSkin.ring;
      ctx.lineWidth = pieceSkin.gloss ? 2.2 : 0.8;
      ctx.stroke();
      if (pieceSkin.gloss) {
        ctx.beginPath();
        ctx.arc(x - 4, y - 5, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff66";
        ctx.fill();
      }
      if (isLast) {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#f34c42";
        ctx.fill();
      }
    }
  }
}

const DICE_SHOW_CLASSES = ["show-1", "show-2", "show-3", "show-4", "show-5", "show-6"];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function animateDiceFace(node, value, matchId, delay = 0) {
  node.classList.remove("is-rolling", ...DICE_SHOW_CLASSES);
  node.style.animationDelay = delay ? delay + "ms" : "";
  node.setAttribute("aria-label", "骰子滚动中");
  void node.offsetWidth;
  node.classList.add("is-rolling");
  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  await pause((reducedMotion ? 30 : 1140) + delay);
  if (diceAnimationMatchId !== matchId) return;
  node.classList.remove("is-rolling");
  node.style.animationDelay = "";
  node.classList.add("show-" + value);
  node.setAttribute("aria-label", value + "点");
}

async function playDiceReveal(match, room) {
  if (!match || !Array.isArray(match.diceRolls) || !match.diceRolls.length) return;
  if (diceAnimationMatchId === match.matchId) return;
  const runId = ++diceAnimationRunId;
  diceAnimationMatchId = match.matchId;
  diceAnimationComplete = false;
  const stage = $("pvpDiceStage");
  stage.hidden = false;
  stage.classList.remove("revealed");
  $("pvpDiceLeftLabel").textContent = room.hostName || "房主";
  $("pvpDiceRightLabel").textContent = room.guestName || "好友";
  $("pvpDiceWinner").textContent = "";

  for (const roll of match.diceRolls) {
    if (runId !== diceAnimationRunId || !roomState || !roomState.match || roomState.match.matchId !== match.matchId) return;
    stage.classList.add("is-rolling");
    $("pvpDiceStatus").textContent = roll.round > 1
      ? "点数相同，重新掷骰 · 第 " + roll.round + " 轮"
      : "骰子滚动中…";
    await Promise.all([
      animateDiceFace($("pvpDiceLeft"), roll.hostRoll, match.matchId, 0),
      animateDiceFace($("pvpDiceRight"), roll.guestRoll, match.matchId, 80)
    ]);
    if (runId !== diceAnimationRunId || !roomState || !roomState.match || roomState.match.matchId !== match.matchId) return;
    stage.classList.remove("is-rolling");
    if (roll.hostRoll === roll.guestRoll) {
      $("pvpDiceStatus").textContent = "双方都是 " + roll.hostRoll + " 点，再来一次！";
      await pause(480);
    } else {
      $("pvpDiceStatus").textContent = "第 " + roll.round + " 轮结果揭晓";
      await pause(220);
    }
  }

  if (runId !== diceAnimationRunId || !roomState || !roomState.match || roomState.match.matchId !== match.matchId) return;
  const winnerId = match.diceWinnerPlayerId || match.blackPlayerId;
  const winnerName = winnerId === room.hostPlayerId ? (room.hostName || "房主") : (room.guestName || "好友");
  const last = match.diceRolls[match.diceRolls.length - 1];
  $("pvpDiceWinner").textContent = winnerName + " 掷出 " +
    (winnerId === room.hostPlayerId ? last.hostRoll : last.guestRoll) + " 点，获得黑棋先手权。";
  $("pvpDiceStatus").textContent = "骰子结果由服务器生成，双方看到的是同一组结果。";
  stage.classList.add("revealed");
  diceAnimationComplete = true;
  saveRoomSession(room.roomId, inviteCode, match.matchId);
  $("pvpBoard").hidden = false;
  drawBoard();
}

function revealDiceImmediately(match, room) {
  if (!match || !Array.isArray(match.diceRolls) || !match.diceRolls.length) return;
  const last = match.diceRolls[match.diceRolls.length - 1];
  const stage = $("pvpDiceStage");
  const left = $("pvpDiceLeft");
  const right = $("pvpDiceRight");
  const winnerId = match.diceWinnerPlayerId || match.blackPlayerId;
  const winnerName = winnerId === room.hostPlayerId ? (room.hostName || "房主") : (room.guestName || "好友");
  stage.hidden = false;
  stage.classList.remove("is-rolling");
  stage.classList.add("revealed");
  $("pvpDiceLeftLabel").textContent = room.hostName || "房主";
  $("pvpDiceRightLabel").textContent = room.guestName || "好友";
  for (const [node, value] of [[left, last.hostRoll], [right, last.guestRoll]]) {
    node.classList.remove("is-rolling", ...DICE_SHOW_CLASSES);
    node.style.animationDelay = "";
    node.classList.add("show-" + value);
    node.setAttribute("aria-label", value + "点");
  }
  $("pvpDiceWinner").textContent = winnerName + " 掷出 " +
    (winnerId === room.hostPlayerId ? last.hostRoll : last.guestRoll) + " 点，获得黑棋先手权。";
  $("pvpDiceStatus").textContent = "骰子结果已揭晓；这是恢复的对局，不重复播放动画。";
  diceAnimationMatchId = match.matchId;
  diceAnimationComplete = true;
  $("pvpBoard").hidden = false;
  drawBoard();
}
async function switchToRematchRoom(nextRoomId) {
  if (!nextRoomId || roomId === nextRoomId) return;
  closePvpResultModal();
  intentionalClose = true;
  closeSocket();
  roomId = nextRoomId;
  inviteCode = "";
  roomState = null;
  diceAnimationRunId++;
  diceAnimationMatchId = "";
  diceAnimationComplete = false;
  $("pvpInviteCode").value = "";
  saveRoomSession(roomId, "", "");
  syncRoomUrl(roomId, "");
  await connectSocket(roomId);
  await refreshRoomState();
  notice("双方已同意再来一局，新棋局已创建。");
}

function renderRoom(room) {
 if(!room)return;
 if (room.status === "cancelled" || room.status === "expired") {
   const message = room.status === "cancelled" ? "这个房间已被取消。" : "这个房间已过期。";
   returnToPvpLobby();
   notice(message, true);
   return;
 }
 if (room.rematchRoomId && roomId && roomId !== room.rematchRoomId) {
   switchToRematchRoom(room.rematchRoomId).catch(error => notice(error.message, true));
   return;
 }
 saveRoomSession(room.roomId, inviteCode);
 roomState=room;$("pvpLobby").hidden=true;$("pvpRoom").hidden=false;$("pvpAuthRequired").hidden=true;
 const names=(room.hostName||"房主")+"（房主） vs "+(room.guestName||"等待好友加入");
 $("pvpRoomTitle").textContent="房间 "+room.roomId.slice(0,8);
 $("pvpRoomPlayers").textContent=names;
 const statusText={waiting:"等待好友加入",ready:"双方已进入，等待准备",active:"对局进行中",finished:"对局已结束",cancelled:"房间已取消",expired:"房间已过期"};
 $("pvpRoomTitle").textContent+=" · "+(statusText[room.status]||room.status);
 const isHost=room.hostPlayerId===playerId,ready=!!(room.readyByPlayer&&room.readyByPlayer[playerId]);
 $("pvpReady").hidden=room.status!=="ready";$("pvpReady").disabled=ready;$("pvpReady").textContent=ready?"已准备，等待对手":"我准备好了";
 $("pvpCancelRoom").hidden=!isHost||!["waiting","ready"].includes(room.status);
 $("pvpInvitePanel").hidden=!inviteCode||!isHost;$("pvpInviteCodeDisplay").textContent=inviteCode;
 if(room.match&&Array.isArray(room.match.diceRolls)&&room.match.diceRolls.length){
  if(diceAnimationMatchId!==room.match.matchId) {
   const saved = loadRoomSession();
   if (saved && saved.roomId === room.roomId && saved.diceMatchId === room.match.matchId) {
    revealDiceImmediately(room.match, room);
   } else {
    playDiceReveal(room.match,room);
   }
  }
  $("pvpDiceStage").hidden=false;$("pvpBoard").hidden=!diceAnimationComplete;
 }else{
  if(!room.match){diceAnimationMatchId="";diceAnimationComplete=false;diceAnimationRunId++;}
  $("pvpDiceStage").hidden=true;$("pvpBoard").hidden=!room.match;
  if(room.match&&!room.match.diceRolls)notice("当前真人对战服务尚未升级摇骰子协议，请先部署 V4.0 服务端。",true);
 }
 const drawBy=room.match&&room.match.pendingDrawBy;
 const drawPending=Boolean(drawBy);
 const myDrawOffer=drawBy===playerId;
 $("pvpOfferDraw").hidden=room.status!=="active"||(drawPending&&!myDrawOffer);
 $("pvpOfferDraw").disabled=myDrawOffer;
 $("pvpOfferDraw").textContent=myDrawOffer?"等待对手回应…":"提出和棋";
 $("pvpResign").hidden=room.status!=="active";
 $("pvpAcceptDraw").hidden=room.status!=="active"||!drawBy||drawBy===playerId;
 $("pvpDeclineDraw").hidden=room.status!=="active"||!drawBy||drawBy===playerId;
 const finished = room.status === "finished" && room.match && room.match.status === "finished";
 const rematchByPlayer = room.rematchByPlayer || {};
 const opponentId = playerId === room.hostPlayerId ? room.guestPlayerId : room.hostPlayerId;
 const myRematchRequested = !!rematchByPlayer[playerId];
 const opponentRematchRequested = !!rematchByPlayer[opponentId];
 const rematchStarting = !!room.rematchStarting;
 const incomingRematchInvite = finished && opponentRematchRequested && !myRematchRequested && !rematchStarting;
 const rematchInviteModal = $("pvpRematchInviteModal");
 const wasRematchInviteHidden = rematchInviteModal.hidden;
 rematchInviteModal.hidden = !incomingRematchInvite;
 if (incomingRematchInvite) {
   if (wasRematchInviteHidden) {
     $("pvpRematchInviteAccept").disabled = false;
     $("pvpRematchInviteDecline").disabled = false;
     $("pvpRematchInviteAccept").focus({preventScroll:true});
   }
   const inviterName = playerId === room.hostPlayerId ? room.guestName : room.hostName;
   $("pvpRematchInviteFrom").textContent = inviterName || "好友";
 }
 $("pvpRematch").hidden = !finished;
 $("pvpRematch").disabled = myRematchRequested || rematchStarting;
 $("pvpRematch").textContent = rematchStarting
   ? "正在创建新对局…"
   : myRematchRequested ? "等待对手同意…"
   : opponentRematchRequested ? "接受再来一局" : "再来一局";
 $("pvpNewMatch").hidden = !finished;
 if(room.match){
  const match=room.match,myRating=match.finalRatings&&match.finalRatings[playerId]!==undefined?match.finalRatings[playerId]:match.initialRatings[playerId];
  const delta=match.finalRatings&&match.initialRatings[playerId]!==undefined?match.finalRatings[playerId]-match.initialRatings[playerId]:0;
  $("pvpMyRating").textContent=String(myRating??1000)+(match.status==="finished"?" · "+(delta>=0?"+":"")+delta:" · 对局中");
  $("pvpTurn").textContent=match.status==="finished"?"对局结束":match.turnPlayerId===playerId?"轮到你落子":"等待对手落子";
  $("pvpTurn").style.color=match.turnPlayerId===playerId?"#986076":"#9a8c86";
 }else{$("pvpTurn").textContent=room.status==="ready"?"等待双方准备":"等待好友加入";$("pvpMyRating").textContent="1000 · 定级中";}
 renderClock();drawBoard();
 if (finished) showPvpResult(room.match, room);
}
async function createRoom() {
  try {
    const result = await api("/api/pvp/rooms", "POST", {timeControlMs: DEFAULT_CLOCK_MS});
    roomId = result.room.id;
    inviteCode = result.inviteCode;
    saveRoomSession(roomId, inviteCode, "");
    syncRoomUrl(roomId, inviteCode);
    renderRoom({
      roomId, status: "waiting", hostPlayerId: playerId, hostName: "你",
      guestPlayerId: null, guestName: null, timeControlMs: DEFAULT_CLOCK_MS,
      readyByPlayer: {}, connectedByPlayer: {}, match: null
    });
    const url = new URL(window.location.href);
    url.searchParams.set("invite", inviteCode);
    history.replaceState(null, "", url.toString());
    await connectSocket(roomId);
    await refreshRoomState();
    notice("房间已创建，邀请码已显示。把邀请码或邀请链接发给好友。");
  } catch (error) { notice(error.message, true); }
}

async function joinRoom() {
  try {
    const code = $("pvpInviteCode").value.trim().toUpperCase();
    const result = await api("/api/pvp/rooms/join", "POST", {inviteCode: code});
    roomId = result.room.id;
    // Keep the invite code for both members so either can recover the exact
    // room from another tab/device; the API still checks authenticated membership.
    inviteCode = code;
    saveRoomSession(roomId, inviteCode, "");
    syncRoomUrl(roomId, inviteCode);
    await refreshRoomState();
    await connectSocket(roomId);
    notice(result.resumed
      ? "已重新进入此前的好友房间，对局状态已恢复。"
      : "已加入好友房间，等待双方准备。");
  } catch (error) { notice(error.message, true); }
}

function returnToPvpLobby() {
  intentionalClose = true;
  closeSocket();
  roomId = "";
  inviteCode = "";
  roomState = null;
  diceAnimationRunId++;
  diceAnimationMatchId = "";
  diceAnimationComplete = false;
  clearRoomSession();
  syncRoomUrl("", "");
  $("pvpRoom").hidden = true;
  $("pvpLobby").hidden = false;
  $("pvpInviteCode").value = "";
  $("pvpDiceStage").hidden = true;
  $("pvpBoard").hidden = true;
  notice("已返回好友对战大厅。可以创建新房间或输入其他好友的邀请码。");
}

async function refreshLeaderboard() {
 try {
  const data=await api("/api/pvp/leaderboard","GET",null,false),players=data.players||[],titles=["棋圣","棋王","棋宗"];
  $("pvpPodium").innerHTML=players.slice(0,3).map((p,i)=>"<article class='podium-card podium-"+(i+1)+"'><span class='podium-medal'>"+["👑","🥈","🥉"][i]+"</span><small>"+titles[i]+"</small><strong>"+escapeText(p.name)+"</strong><em>"+Number(p.rating)+" Elo</em></article>").join("");
  $("pvpRankRows").innerHTML=players.length?players.map((p,i)=>"<tr><td>"+(i+1)+"</td><td>"+escapeText(p.name)+(titles[i]?" <span class='rank-title rank-"+(i+1)+"'>"+titles[i]+"</span>":"")+"</td><td>"+escapeText(p.tier)+"</td><td>"+Number(p.rating)+"</td><td>"+Number(p.rated_games)+"</td><td>"+Number(p.wins)+"/"+Number(p.losses)+"/"+Number(p.draws)+"</td></tr>").join(""):"<tr><td colspan='6'>还没有真人对局，来拿下第一胜吧！</td></tr>";
 }catch(error){$("pvpRankRows").innerHTML="<tr><td colspan='6'>"+escapeText(error.message)+"</td></tr>";}
}
async function refreshHistory() {
  try {
    const data = await api("/api/pvp/history");
    $("pvpHistoryRows").innerHTML = data.matches.length ? data.matches.map(match => {
      const opponent = match.my_color === "black" ? match.white_name : match.black_name;
      const mine = match.my_color === "black" ? match.black_player_id : match.white_player_id;
      const won = (match.result === "black_win" && match.my_color === "black") || (match.result === "white_win" && match.my_color === "white");
      const outcome = match.result === "draw" ? "和棋" : won ? "胜利" : "失利";
      const before = match.my_color === "black" ? match.initial_black_rating : match.initial_white_rating;
      const after = match.my_color === "black" ? match.final_black_rating : match.final_white_rating;
      const delta = after == null ? "—" : ((Number(after) - Number(before)) >= 0 ? "+" : "") + (Number(after) - Number(before));
      return "<tr><td>" + escapeText(match.started_at || "") + "</td><td>" + escapeText(opponent) +
        "</td><td>" + outcome + "</td><td>" + escapeText(match.end_reason || "") +
        "</td><td>" + delta + "</td></tr>";
    }).join("") : "<tr><td colspan='5'>暂时没有真人对局记录。</td></tr>";
  } catch (error) {
    $("pvpHistoryRows").innerHTML = "<tr><td colspan='5'>" + escapeText(error.message) + "</td></tr>";
  }
}

function sendAction(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    notice("实时连接尚未就绪，请稍等或刷新房间状态。", true);
    return false;
  }
  try {
    socket.send(JSON.stringify(message));
  } catch {
    notice("操作发送失败，请检查网络连接后重试。", true);
    return false;
  }
  const feedback = {
    offer_draw: "已向对手发送和棋请求，等待回应。",
    accept_draw: "你已接受和棋请求，正在完成结算…",
    decline_draw: "已拒绝和棋请求，对局继续。",
    decline_rematch: "已提交拒绝再来一局邀请。",
    resign: "已提交认输，正在确认本局结果…"
  };
  if (feedback[message.type]) notice(feedback[message.type]);
  return true;
}

$("tab-pvp").onclick = () => {
  if (window.activateGomokuTab) window.activateGomokuTab("pvp");
};
$("pvpLoginLink").onclick = () => {
  if (window.activateGomokuTab) window.activateGomokuTab("account");
};
$("pvpCreateRoom").onclick = async () => { await tokenOrThrow().catch(error => notice(error.message, true)); if (playerId) await createRoom(); };
$("pvpJoinRoom").onclick = async () => { await tokenOrThrow().catch(error => notice(error.message, true)); if (playerId) await joinRoom(); };
$("pvpReady").onclick = () => sendAction({type: "ready"});
$("pvpResultClose").onclick = closePvpResultModal;
$("pvpResultContinue").onclick = closePvpResultModal;
$("pvpRematch").onclick = () => sendAction({type: "rematch"});
$("pvpRematchInviteAccept").onclick = () => {
  $("pvpRematchInviteAccept").disabled = true;
  $("pvpRematchInviteDecline").disabled = true;
  if (!sendAction({type: "rematch"})) {
    $("pvpRematchInviteAccept").disabled = false;
    $("pvpRematchInviteDecline").disabled = false;
  }
};
$("pvpRematchInviteDecline").onclick = () => {
  $("pvpRematchInviteAccept").disabled = true;
  $("pvpRematchInviteDecline").disabled = true;
  if (!sendAction({type: "decline_rematch"})) {
    $("pvpRematchInviteAccept").disabled = false;
    $("pvpRematchInviteDecline").disabled = false;
  }
};
$("pvpNewMatch").onclick = () => { if (roomState && roomState.status === "finished") returnToPvpLobby(); };
$("pvpOfferDraw").onclick = () => sendAction({type: "offer_draw"});
$("pvpAcceptDraw").onclick = () => sendAction({type: "accept_draw"});
$("pvpDeclineDraw").onclick = () => sendAction({type: "decline_draw"});
$("pvpResign").onclick = () => {
  if (confirm("确定认输吗？本局将计入真人段位。")) sendAction({type: "resign"});
};
$("pvpCancelRoom").onclick = async () => {
  if (!roomId || !confirm("确定取消这个等待中的房间吗？")) return;
  try {
    await api("/api/pvp/rooms/" + encodeURIComponent(roomId) + "/cancel", "POST", {});
    returnToPvpLobby();
    notice("房间已取消。");
  } catch (error) { notice(error.message, true); }
};
$("pvpCopyInvite").onclick = async () => {
  try { await navigator.clipboard.writeText(inviteCode); notice("邀请码已复制。"); }
  catch { notice("请手动复制邀请码：" + inviteCode); }
};
$("pvpCopyInviteLink").onclick = async () => {
  const url = new URL(window.location.href);
  url.searchParams.set("invite", inviteCode);
  try { await navigator.clipboard.writeText(url.toString()); notice("邀请链接已复制。"); }
  catch { notice(url.toString()); }
};
$("pvpRefreshLeaderboard").onclick = refreshLeaderboard;
$("pvpRefreshHistory").onclick = refreshHistory;
$("pvpBoard").addEventListener("click", event => {
  const match = roomState && roomState.match;
  if (!match || match.status !== "active" || match.turnPlayerId !== playerId) return;
  const rect = $("pvpBoard").getBoundingClientRect();
  const x = (event.clientX - rect.left) * 600 / rect.width;
  const y = (event.clientY - rect.top) * 600 / rect.height;
  const offset = 48, cell = 36;
  const col = Math.round((x - offset) / cell);
  const row = Math.round((y - offset) / cell);
  if (row < 0 || row >= 15 || col < 0 || col >= 15) return;
  if (Math.hypot(x - (offset + col * cell), y - (offset + row * cell)) > 18) return;
  const cellIndex = row * 15 + col;
  if (match.board[cellIndex]) return;
  sendAction({type: "move", cellIndex, revision: match.revision, actionId: crypto.randomUUID()});
});

const initialParams = new URLSearchParams(window.location.search);
const initialInvite = initialParams.get("invite");
const initialPvpRoom = initialParams.get("pvpRoom");
if (initialInvite) $("pvpInviteCode").value = initialInvite.toUpperCase();
if (!API) notice("PVP 后端尚未部署。当前分支先完成前端与服务端开发，部署后即可联调。", true);
else notice("PVP 服务已配置。登录后创建房间或输入好友邀请码。");

let roomRestoreInProgress = false;
let restoredPlayerId = "";
async function restorePvpRoomOnLoad() {
  if (roomRestoreInProgress) return;
  roomRestoreInProgress = true;
  try {
    await waitForAuthReady();
    await tokenOrThrow();
    if (restoredPlayerId === playerId && roomId && roomState) return;

    const saved = loadRoomSession();
    let resumeId = "";
    if (initialInvite) {
      // An invite URL is the strongest room locator, including for a guest
      // who joined on another browser and has no localStorage entry.
      const current = await api("/api/pvp/rooms/current?invite=" + encodeURIComponent(initialInvite));
      resumeId = current.room ? current.room.id : "";
    } else {
      const current = await api("/api/pvp/rooms/current");
      resumeId = current.room ? current.room.id : (initialPvpRoom || saved?.roomId || "");
    }
    if (!resumeId) {
      restoredPlayerId = playerId;
      return;
    }

    roomId = resumeId;
    inviteCode = initialInvite || (saved?.roomId === resumeId ? saved.inviteCode || "" : "");
    await connectSocket(roomId);
    await refreshRoomState();
    if (!roomId || !roomState) return;
    saveRoomSession(roomId, inviteCode);
    syncRoomUrl(roomId, inviteCode);
    if (typeof window.activateGomokuTab === "function") window.activateGomokuTab("pvp");
    restoredPlayerId = playerId;
    notice("已恢复你此前的好友房间，棋盘和对局状态已同步。");
  } catch (error) {
    if ([403, 404, 410].includes(error.status)) {
      clearRoomSession();
      roomId = "";
      inviteCode = "";
      roomState = null;
      syncRoomUrl("", "");
      $("pvpRoom").hidden = true;
      $("pvpLobby").hidden = false;
    }
    notice("恢复好友房间失败：" + error.message, true);
  } finally {
    roomRestoreInProgress = false;
  }
}

window.addEventListener("gomoku:auth-changed", event => {
  if (event.detail && event.detail.signedIn) restorePvpRoomOnLoad();
});
waitForAuthReady().then(() => {
  if (initialPvpRoom || initialInvite) {
    if (typeof window.activateGomokuTab === "function") window.activateGomokuTab("pvp");
  }
  if (loggedIn()) {
    restorePvpRoomOnLoad();
  } else if (initialPvpRoom || initialInvite) {
    $("pvpAuthRequired").hidden = false;
    notice("检测到好友房间链接，请先登录；登录成功后会自动恢复房间。");
  }
}).catch(error => notice("账号初始化失败：" + error.message, true));
refreshLeaderboard();
setInterval(() => {
  renderClock();
  if (roomState && roomState.match && roomState.match.status === "active") drawBoard();
}, 250);
