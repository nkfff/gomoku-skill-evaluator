import {createRemoteJWKSet, jwtVerify} from "jose";
import {DEFAULT_TIME_CONTROL_MS, ratingTier} from "../src/pvp.js";
import {PvpRoom} from "./pvp-room.js";
export {PvpRoom};

const reply = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers}
});
const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const parseBody = async request => {
  try { return await request.json(); } catch { throw fail("请求内容不是有效 JSON"); }
};
let jwksUrl = "";
let jwks;

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.FRONTEND_ORIGIN || "https://nkfff.github.io").replace(/\/$/, "");
  const devOrigin = env.DEV_ORIGIN || "";
  if (origin && (origin === allowed || origin === devOrigin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Credentials": "true",
      "Vary": "Origin"
    };
  }
  return {};
}

async function authenticate(request, env) {
  const token = (request.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || !env.SUPABASE_URL) throw fail("需要登录", 401);
  const issuer = env.SUPABASE_URL.replace(/\/$/, "");
  const url = issuer + "/auth/v1/.well-known/jwks.json";
  if (jwksUrl !== url) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksUrl = url;
  }
  try {
    const {payload} = await jwtVerify(token, jwks, {
      issuer: issuer + "/auth/v1",
      audience: "authenticated",
      algorithms: ["ES256", "RS256"]
    });
    if (!uuid(payload.sub) || payload.role !== "authenticated") throw new Error("Invalid user token");
    return {id: payload.sub, email: typeof payload.email === "string" ? payload.email : null};
  } catch {
    throw fail("登录已过期或身份验证失败", 401);
  }
}

async function ensurePlayer(env, user) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO players(id,name,points,wins,losses,draws,inventory,created_at,email) VALUES(?,'匿名棋手',0,0,0,0,'[\"classic\",\"board:classic\",\"piece:classic\"]',datetime('now'),?)"
  ).bind(user.id, user.email).run();
  const player = await env.DB.prepare("SELECT id,name,banned FROM players WHERE id=?").bind(user.id).first();
  if (!player) throw fail("无法创建玩家档案", 500);
  if (player.banned) throw fail("该账号当前不可进行游戏", 403);
  return player;
}

async function assertNoActiveMatch(env, playerId) {
  const active = await env.DB.prepare("SELECT room_id FROM pvp_active_players WHERE player_id=?").bind(playerId).first();
  if (active) throw fail("你已有进行中的真人对局，请先返回该房间", 409);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte => alphabet[byte % alphabet.length]).join("");
}

function randomTicket() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function callRoom(env, roomId, path, {method = "GET", playerId = "", body = null} = {}) {
  if (!env.PVP_ROOMS) throw fail("PVP 房间服务未配置", 503);
  const stub = env.PVP_ROOMS.get(env.PVP_ROOMS.idFromName(roomId));
  const headers = new Headers({"Content-Type": "application/json"});
  if (playerId) headers.set("x-player-id", playerId);
  const response = await stub.fetch(new Request("https://pvp-room" + path, {
    method, headers, body: body === null ? undefined : JSON.stringify(body)
  }));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw fail(data.error || "房间服务请求失败", response.status);
  return data;
}

async function roomForPlayer(env, roomId, playerId) {
  if (!uuid(roomId)) throw fail("房间 ID 无效");
  const room = await env.DB.prepare("SELECT * FROM pvp_rooms WHERE id=?").bind(roomId).first();
  if (!room) throw fail("房间不存在", 404);
  if (room.host_player_id !== playerId && room.guest_player_id !== playerId) throw fail("你不属于这个房间", 403);
  return room;
}

async function handleWebSocket(request, env, roomId) {
  if (request.headers.get("Upgrade") !== "websocket") throw fail("需要 WebSocket Upgrade", 426);
  const ticket = new URL(request.url).searchParams.get("ticket") || "";
  if (ticket.length < 32 || ticket.length > 256) throw fail("连接凭证无效或已过期", 401);
  const tokenHash = await sha256(ticket);
  const row = await env.DB.prepare(
    "SELECT t.player_id,t.room_id FROM pvp_connection_tickets t JOIN pvp_rooms r ON r.id=t.room_id WHERE t.token_hash=? AND t.room_id=? AND t.consumed_at IS NULL AND t.expires_at>datetime('now') AND (r.host_player_id=t.player_id OR r.guest_player_id=t.player_id) AND r.status IN ('waiting','ready','active','finished')"
  ).bind(tokenHash, roomId).first();
  if (!row) throw fail("连接凭证无效或已过期，请重新连接", 401);
  const consumed = await env.DB.prepare(
    "UPDATE pvp_connection_tickets SET consumed_at=datetime('now') WHERE token_hash=? AND consumed_at IS NULL AND expires_at>datetime('now')"
  ).bind(tokenHash).run();
  if (consumed.meta.changes !== 1) throw fail("连接凭证已使用，请重新连接", 401);
  if (!env.PVP_ROOMS) throw fail("PVP 房间服务未配置", 503);
  const stub = env.PVP_ROOMS.get(env.PVP_ROOMS.idFromName(roomId));
  const headers = new Headers(request.headers);
  headers.set("x-player-id", row.player_id);
  return stub.fetch(new Request("https://pvp-room/websocket", {method: "GET", headers}));
}

async function createRoom(request, env, user, headers) {
  const player = await ensurePlayer(env, user);
  await assertNoActiveMatch(env, user.id);
  const body = await parseBody(request);
  const requestedTime = Number(body.timeControlMs || DEFAULT_TIME_CONTROL_MS);
  if (requestedTime !== DEFAULT_TIME_CONTROL_MS) throw fail("第一版暂时固定每方 10 分钟用时");
  const roomId = crypto.randomUUID();
  const inviteCode = randomCode();
  const inviteHash = await sha256(inviteCode);
  await env.DB.prepare(
    "INSERT INTO pvp_rooms(id,host_player_id,invite_code_hash,status,time_control_ms,rated,expires_at) VALUES(?,?,?,'waiting',?,1,datetime('now','+24 hours'))"
  ).bind(roomId, user.id, inviteHash, DEFAULT_TIME_CONTROL_MS).run();
  try {
    await callRoom(env, roomId, "/internal/init", {
      method: "POST",
      body: {
        roomId, hostPlayerId: user.id, hostName: player.name || "棋手",
        timeControlMs: DEFAULT_TIME_CONTROL_MS, expiresAt: Date.now() + 24 * 60 * 60 * 1000
      }
    });
  } catch (error) {
    await env.DB.prepare("DELETE FROM pvp_rooms WHERE id=? AND status='waiting'").bind(roomId).run();
    throw error;
  }
  return reply({
    room: {id: roomId, status: "waiting", hostPlayerId: user.id, hostName: player.name, timeControlMs: DEFAULT_TIME_CONTROL_MS},
    inviteCode,
    expiresInHours: 24,
    message: "邀请码只在创建时显示，请复制并分享给好友。"
  }, 201, headers);
}

async function joinRoom(request, env, user, headers) {
  const player = await ensurePlayer(env, user);
  await assertNoActiveMatch(env, user.id);
  const body = await parseBody(request);
  const code = String(body.inviteCode || "").trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw fail("邀请码格式不正确");
  const inviteHash = await sha256(code);
  const room = await env.DB.prepare(
    "SELECT id,host_player_id,guest_player_id,status,expires_at FROM pvp_rooms WHERE invite_code_hash=?"
  ).bind(inviteHash).first();
  if (!room) throw fail("邀请码不存在", 404);
  if (room.host_player_id === user.id) throw fail("不能加入自己创建的房间", 409);
  if (room.status !== "waiting" || room.guest_player_id) throw fail("房间已满或已开始", 409);
  if (new Date(room.expires_at.replace(" ", "T") + "Z").getTime() <= Date.now()) throw fail("房间已过期", 410);
  const updated = await env.DB.prepare(
    "UPDATE pvp_rooms SET guest_player_id=?,status='ready' WHERE id=? AND status='waiting' AND guest_player_id IS NULL AND expires_at>datetime('now')"
  ).bind(user.id, room.id).run();
  if (updated.meta.changes !== 1) throw fail("房间刚刚被其他玩家加入，请重新尝试", 409);
  try {
    await callRoom(env, room.id, "/internal/join", {
      method: "POST",
      body: {playerId: user.id, playerName: player.name || "棋手"}
    });
  } catch (error) {
    await env.DB.prepare("UPDATE pvp_rooms SET guest_player_id=NULL,status='waiting' WHERE id=? AND guest_player_id=? AND status='ready'").bind(room.id, user.id).run();
    throw error;
  }
  return reply({
    room: {id: room.id, status: "ready", hostPlayerId: room.host_player_id, guestPlayerId: user.id},
    message: "已加入房间。双方连接后点击准备即可开始。"
  }, 200, headers);
}

async function createTicket(env, roomId, playerId, headers) {
  await roomForPlayer(env, roomId, playerId);
  const ticket = randomTicket();
  const tokenHash = await sha256(ticket);
  await env.DB.prepare(
    "INSERT INTO pvp_connection_tickets(token_hash,room_id,player_id,expires_at) VALUES(?,?,?,datetime('now','+45 seconds'))"
  ).bind(tokenHash, roomId, playerId).run();
  return reply({ticket, expiresInSeconds: 45}, 200, headers);
}

async function leaderboard(env, headers) {
  const {results} = await env.DB.prepare(
    "SELECT p.id,p.name,r.rating,r.rated_games,r.wins,r.losses,r.draws,r.peak_rating,CASE WHEN r.rated_games<10 THEN '定级中' WHEN r.rating<800 THEN '新手' WHEN r.rating<1000 THEN '青铜' WHEN r.rating<1200 THEN '白银' WHEN r.rating<1400 THEN '黄金' WHEN r.rating<1600 THEN '铂金' WHEN r.rating<1800 THEN '钻石' ELSE '大师' END AS tier FROM pvp_ratings r JOIN players p ON p.id=r.player_id WHERE COALESCE(p.banned,0)=0 ORDER BY r.rating DESC,r.rated_games DESC,r.wins DESC LIMIT 50"
  ).all();
  return reply({players: results}, 200, headers);
}

async function history(env, playerId, headers) {
  const {results} = await env.DB.prepare(
    "SELECT m.id,m.room_id,m.black_player_id,m.white_player_id,b.name AS black_name,w.name AS white_name,m.result,m.end_reason,m.move_count,m.initial_black_rating,m.initial_white_rating,m.final_black_rating,m.final_white_rating,m.started_at,m.ended_at,CASE WHEN m.black_player_id=? THEN 'black' ELSE 'white' END AS my_color FROM pvp_matches m JOIN players b ON b.id=m.black_player_id JOIN players w ON w.id=m.white_player_id WHERE m.black_player_id=? OR m.white_player_id=? ORDER BY m.started_at DESC LIMIT 50"
  ).bind(playerId, playerId, playerId).all();
  return reply({matches: results}, 200, headers);
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, {status: 204, headers});
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.FRONTEND_ORIGIN || "https://nkfff.github.io").replace(/\/$/, "");
    if (origin && origin !== allowed && origin !== (env.DEV_ORIGIN || "")) return reply({error: "Origin 不允许"}, 403);
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health") return reply({
        ok: true, version: "3.0.0-alpha.1",
        configured: !!env.SUPABASE_URL,
        pvpConfigured: !!env.PVP_ROOMS,
        databaseConfigured: !!env.DB
      }, 200, headers);

      const websocketMatch = url.pathname.match(/^\/api\/pvp\/rooms\/([0-9a-f-]+)\/ws$/i);
      if (websocketMatch && request.method === "GET") {
        return await handleWebSocket(request, env, websocketMatch[1]);
      }

      if (url.pathname === "/api/pvp/leaderboard" && request.method === "GET") return await leaderboard(env, headers);

      const user = await authenticate(request, env);
      if (url.pathname === "/api/pvp/rooms" && request.method === "POST") return await createRoom(request, env, user, headers);
      if (url.pathname === "/api/pvp/rooms/join" && request.method === "POST") return await joinRoom(request, env, user, headers);
      if (url.pathname === "/api/pvp/history" && request.method === "GET") {
        await ensurePlayer(env, user);
        return await history(env, user.id, headers);
      }

      const ticketMatch = url.pathname.match(/^\/api\/pvp\/rooms\/([0-9a-f-]+)\/ticket$/i);
      if (ticketMatch && request.method === "POST") {
        await ensurePlayer(env, user);
        return await createTicket(env, ticketMatch[1], user.id, headers);
      }

      const cancelMatch = url.pathname.match(/^\/api\/pvp\/rooms\/([0-9a-f-]+)\/cancel$/i);
      if (cancelMatch && request.method === "POST") {
        await ensurePlayer(env, user);
        const room = await roomForPlayer(env, cancelMatch[1], user.id);
        if (room.host_player_id !== user.id) throw fail("只有房主可以取消房间", 403);
        return reply(await callRoom(env, room.id, "/internal/cancel", {method: "POST", playerId: user.id}), 200, headers);
      }

      const roomMatch = url.pathname.match(/^\/api\/pvp\/rooms\/([0-9a-f-]+)$/i);
      if (roomMatch && request.method === "GET") {
        await ensurePlayer(env, user);
        const room = await roomForPlayer(env, roomMatch[1], user.id);
        return reply(await callRoom(env, room.id, "/internal/state", {playerId: user.id}), 200, headers);
      }

      throw fail("接口不存在", 404);
    } catch (error) {
      return reply({error: error.message || "服务端处理失败"}, error.status || 500, headers);
    }
  }
};
