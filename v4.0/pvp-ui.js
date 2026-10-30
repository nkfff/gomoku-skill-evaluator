import {bearer, loggedIn} from "./src/account.js";

const $ = id => document.getElementById(id);
const API = String(window.GOMOKU_PVP_API_URL || "").replace(/\/$/, "");
const DEFAULT_CLOCK_MS = 600000;
let roomId = "";
let inviteCode = "";
let playerId = "";
let roomState = null;
let diceAnimationMatchId = "";
let diceAnimationComplete = false;
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
  const token = await bearer();
  if (!token || !loggedIn()) {
    $("pvpAuthRequired").hidden = false;
    throw new Error("请先在「账号 / 管理」页面登录账号。");
  }
  playerId = playerFromToken(token);
  return token;
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
  if (!response.ok) throw new Error(data.error || "PVP 服务请求失败");
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
  ws.onopen = () => notice("已连接房间。双方点击「我准备好了」后开始对局。");
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
    notice(message.message || "对局操作失败", true);
    if (message.code === "STALE_REVISION") refreshRoomState().catch(() => {});
  } else if (message.type === "match_started") {
    notice("双方摇骰揭晓先手！点数较大的一方执黑先行。");
  } else if (message.type === "game_over") {
    const match = message.room && message.room.match;
    const result = match ? match.result : "";
    notice(result === "draw" ? "棋逢对手！本局按真人 Elo 和棋规则结算。" :
      match && match.winnerPlayerId === playerId ? "漂亮！你赢下了这局真人对战。" :
      "本局结束，别急着走，复盘一下会更强。");
    refreshHistory().catch(() => {});
    refreshLeaderboard().catch(() => {});
  } else if (message.type === "draw_offered") {
    if (message.playerId !== playerId) notice("对手提出和棋，你可以接受或拒绝。");
  } else if (message.type === "draw_declined") {
    notice("对手拒绝了和棋，继续战斗。");
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

function diceFace(value) { return ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"][Number(value)] || "⚄"; }
async function playDiceReveal(match, room) {
 if(!match||!Array.isArray(match.diceRolls)||!match.diceRolls.length)return;
 if(diceAnimationMatchId===match.matchId)return;
 diceAnimationMatchId=match.matchId;diceAnimationComplete=false;
 const stage=$("pvpDiceStage");stage.hidden=false;stage.classList.remove("revealed");
 $("pvpDiceLeftLabel").textContent=room.hostName||"房主";$("pvpDiceRightLabel").textContent=room.guestName||"好友";$("pvpDiceWinner").textContent="";
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 for(const roll of match.diceRolls){
  if(!roomState||!roomState.match||roomState.match.matchId!==match.matchId)return;
  stage.classList.add("is-rolling");
  $("pvpDiceStatus").textContent=roll.round>1?"点数相同，重新掷骰 · 第 "+roll.round+" 轮":"骰子滚动中…";
  $("pvpDiceLeft").textContent="⚄";$("pvpDiceRight").textContent="⚂";
  await pause(760);
  $("pvpDiceLeft").textContent=diceFace(roll.hostRoll);$("pvpDiceRight").textContent=diceFace(roll.guestRoll);
  stage.classList.remove("is-rolling");
  if(roll.hostRoll===roll.guestRoll){$("pvpDiceStatus").textContent="双方都是 "+roll.hostRoll+" 点，再来一次！";await pause(520);}
  else $("pvpDiceStatus").textContent="第 "+roll.round+" 轮结果揭晓";
 }
 if(!roomState||!roomState.match||roomState.match.matchId!==match.matchId)return;
 const winnerId=match.diceWinnerPlayerId||match.blackPlayerId;
 const winnerName=winnerId===room.hostPlayerId?(room.hostName||"房主"):(room.guestName||"好友");
 const last=match.diceRolls[match.diceRolls.length-1];
 $("pvpDiceWinner").textContent=winnerName+" 掷出 "+(winnerId===room.hostPlayerId?last.hostRoll:last.guestRoll)+" 点，获得黑棋先手权。";
 $("pvpDiceStatus").textContent="骰子结果由服务器生成，双方看到的是同一组结果。";
 stage.classList.add("revealed");diceAnimationComplete=true;$("pvpBoard").hidden=false;drawBoard();
}
function renderRoom(room) {
 if(!room)return;
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
  if(diceAnimationMatchId!==room.match.matchId)playDiceReveal(room.match,room);
  $("pvpDiceStage").hidden=false;$("pvpBoard").hidden=!diceAnimationComplete;
 }else{
  if(!room.match){diceAnimationMatchId="";diceAnimationComplete=false;}
  $("pvpDiceStage").hidden=true;$("pvpBoard").hidden=!room.match;
  if(room.match&&!room.match.diceRolls)notice("当前真人对战服务尚未升级摇骰子协议，请先部署 V4.0 服务端。",true);
 }
 $("pvpOfferDraw").hidden=room.status!=="active";$("pvpResign").hidden=room.status!=="active";
 const drawBy=room.match&&room.match.pendingDrawBy;
 $("pvpAcceptDraw").hidden=room.status!=="active"||!drawBy||drawBy===playerId;
 $("pvpDeclineDraw").hidden=room.status!=="active"||!drawBy||drawBy===playerId;
 if(room.match){
  const match=room.match,myRating=match.finalRatings&&match.finalRatings[playerId]!==undefined?match.finalRatings[playerId]:match.initialRatings[playerId];
  const delta=match.finalRatings&&match.initialRatings[playerId]!==undefined?match.finalRatings[playerId]-match.initialRatings[playerId]:0;
  $("pvpMyRating").textContent=String(myRating??1000)+(match.status==="finished"?" · "+(delta>=0?"+":"")+delta:" · 对局中");
  $("pvpTurn").textContent=match.status==="finished"?"对局结束":match.turnPlayerId===playerId?"轮到你落子":"等待对手落子";
  $("pvpTurn").style.color=match.turnPlayerId===playerId?"#986076":"#9a8c86";
 }else{$("pvpTurn").textContent=room.status==="ready"?"等待双方准备":"等待好友加入";$("pvpMyRating").textContent="1000 · 定级中";}
 renderClock();drawBoard();
}
async function createRoom() {
  try {
    const result = await api("/api/pvp/rooms", "POST", {timeControlMs: DEFAULT_CLOCK_MS});
    roomId = result.room.id;
    inviteCode = result.inviteCode;
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
    inviteCode = "";
    await refreshRoomState();
    await connectSocket(roomId);
    notice("已加入好友房间，等待双方准备。");
  } catch (error) { notice(error.message, true); }
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
    return;
  }
  socket.send(JSON.stringify(message));
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
    intentionalClose = true;
    closeSocket();
    roomId = "";
    inviteCode = "";
    roomState = null;
    $("pvpRoom").hidden = true;
    $("pvpLobby").hidden = false;
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

const initialInvite = new URLSearchParams(window.location.search).get("invite");
if (initialInvite) $("pvpInviteCode").value = initialInvite.toUpperCase();
if (!API) notice("PVP 后端尚未部署。当前分支先完成前端与服务端开发，部署后即可联调。", true);
else notice("PVP 服务已配置。登录后创建房间或输入好友邀请码。");
refreshLeaderboard();
setInterval(() => {
  renderClock();
  if (roomState && roomState.match && roomState.match.status === "active") drawBoard();
}, 250);
