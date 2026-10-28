import {
  DEFAULT_TIME_CONTROL_MS, applyPvpMove, calculateElo, createMatchState,
  finishByResign, finishByTimeout, publicMatchState
} from "../src/pvp.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}
});
const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const nowMs = () => Date.now();
const DISCONNECT_GRACE_MS = 60_000;

export class PvpRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ready = this.ctx.storage.get("room").then(room => { this.room = room || null; });
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/internal/init") return await this.initialize(request);
      if (request.method === "POST" && url.pathname === "/internal/join") return await this.join(request);
      if (request.method === "POST" && url.pathname === "/internal/cancel") return await this.cancel(request);
      if (request.method === "GET" && url.pathname === "/internal/state") {
        const playerId = request.headers.get("x-player-id") || "";
        this.requireMember(playerId);
        return json(this.snapshot(playerId));
      }
      if (url.pathname === "/websocket" && request.headers.get("Upgrade") === "websocket") {
        return await this.connect(request);
      }
      return json({error: "Not found"}, 404);
    } catch (error) {
      return json({error: error.message || "PVP room error"}, error.status || 400);
    }
  }

  async initialize(request) {
    const data = await request.json();
    if (this.room) return json({ok: true, roomId: this.room.roomId});
    if (!data.roomId || !data.hostPlayerId) return json({error: "Invalid room initialization"}, 400);
    const now = nowMs();
    this.room = {
      roomId: data.roomId,
      status: "waiting",
      hostPlayerId: data.hostPlayerId,
      hostName: data.hostName || "棋手",
      guestPlayerId: null,
      guestName: null,
      timeControlMs: Number.isInteger(data.timeControlMs) && data.timeControlMs > 0 ? data.timeControlMs : DEFAULT_TIME_CONTROL_MS,
      rated: true,
      createdAt: now,
      expiresAt: Number(data.expiresAt) || now + 24 * 60 * 60 * 1000,
      readyByPlayer: {},
      connectedByPlayer: {},
      disconnectedAt: {},
      match: null
    };
    await this.ctx.storage.put("room", this.room);
    await this.scheduleNextAlarm();
    return json({ok: true, roomId: this.room.roomId});
  }

  async join(request) {
    const data = await request.json();
    if (!this.room) return json({error: "Room not found"}, 404);
    if (this.room.status !== "waiting" || this.room.guestPlayerId) return json({error: "房间已满或不再接受加入"}, 409);
    if (Number(this.room.expiresAt) <= nowMs()) return json({error: "房间已过期"}, 410);
    if (!data.playerId || data.playerId === this.room.hostPlayerId) return json({error: "不能以房主身份重复加入"}, 400);
    this.room.guestPlayerId = data.playerId;
    this.room.guestName = data.playerName || "棋手";
    this.room.status = "ready";
    this.room.readyByPlayer = {};
    await this.ctx.storage.put("room", this.room);
    await this.scheduleNextAlarm();
    this.broadcast({type: "room_state", room: this.snapshot(this.room.hostPlayerId)});
    return json({ok: true, roomId: this.room.roomId, status: this.room.status});
  }

  async cancel(request) {
    const playerId = request.headers.get("x-player-id") || "";
    if (!this.room) return json({error: "Room not found"}, 404);
    if (playerId !== this.room.hostPlayerId) return json({error: "只有房主可以取消房间"}, 403);
    if (!["waiting", "ready"].includes(this.room.status)) return json({error: "对局已开始，不能取消房间"}, 409);
    this.room.status = "cancelled";
    await this.ctx.storage.put("room", this.room);
    await this.env.DB.prepare("UPDATE pvp_rooms SET status='cancelled', ended_at=datetime('now') WHERE id=? AND status IN ('waiting','ready')").bind(this.room.roomId).run();
    this.broadcast({type: "room_state", room: this.snapshot(playerId)});
    return json({ok: true, status: "cancelled"});
  }

  async connect(request) {
    if (!this.room) return json({error: "Room not found"}, 404);
    const playerId = request.headers.get("x-player-id") || "";
    this.requireMember(playerId);
    if (!["waiting", "ready", "active", "finished"].includes(this.room.status)) return json({error: "房间当前不可连接"}, 409);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({playerId});
    this.room.connectedByPlayer[playerId] = true;
    delete this.room.disconnectedAt[playerId];
    await this.ctx.storage.put("room", this.room);
    server.send(JSON.stringify({type: "room_state", room: this.snapshot(playerId)}));
    this.broadcast({type: "presence", playerId, connected: true});
    await this.scheduleNextAlarm();
    return new Response(null, {status: 101, webSocket: client});
  }

  async webSocketMessage(socket, rawMessage) {
    await this.ready;
    const attachment = socket.deserializeAttachment() || {};
    const playerId = attachment.playerId;
    if (!this.room || !playerId) return;
    let message;
    try {
      message = parse(typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage));
    } catch { message = null; }
    if (!message || typeof message.type !== "string") {
      this.sendTo(socket, {type: "error", code: "INVALID_MESSAGE", message: "消息格式不正确"});
      return;
    }
    try {
      this.requireMember(playerId);
      if (message.type === "ping") {
        this.sendTo(socket, {type: "pong", now: nowMs()});
        return;
      }
      if (message.type === "ready") return await this.markReady(playerId);
      if (message.type === "move") return await this.move(playerId, message);
      if (message.type === "resign") return await this.resign(playerId);
      if (message.type === "offer_draw") return await this.offerDraw(playerId);
      if (message.type === "accept_draw") return await this.acceptDraw(playerId);
      if (message.type === "decline_draw") return await this.declineDraw(playerId);
      this.sendTo(socket, {type: "error", code: "UNKNOWN_ACTION", message: "不支持的操作"});
    } catch (error) {
      this.sendTo(socket, {type: "error", code: error.message || "PVP_ERROR", message: this.errorText(error.message)});
    }
  }

  async webSocketClose(socket) {
    await this.ready;
    const playerId = (socket.deserializeAttachment() || {}).playerId;
    if (!this.room || !playerId || !this.isMember(playerId)) return;
    this.room.connectedByPlayer[playerId] = false;
    this.room.disconnectedAt[playerId] = nowMs();
    await this.ctx.storage.put("room", this.room);
    this.broadcast({type: "presence", playerId, connected: false, graceMs: DISCONNECT_GRACE_MS});
    await this.scheduleNextAlarm();
  }

  async webSocketError(socket) {
    return this.webSocketClose(socket);
  }

  async alarm() {
    await this.ready;
    if (!this.room) return;
    const now = nowMs();
    if (this.room.status === "finished" && this.room.settlementPending && this.room.match) {
      await this.finishMatch(this.room.match.endReason || "five_in_row");
      return;
    }
    if (["waiting", "ready"].includes(this.room.status) && now >= this.room.expiresAt) {
      this.room.status = "expired";
      await this.ctx.storage.put("room", this.room);
      await this.env.DB.prepare("UPDATE pvp_rooms SET status='expired' WHERE id=? AND status IN ('waiting','ready')").bind(this.room.roomId).run();
      this.broadcast({type: "room_state", room: this.snapshot(this.room.hostPlayerId)});
      return;
    }
    if (this.room.status === "active" && this.room.match) {
      const match = this.room.match;
      const currentColor = match.turnColor;
      const key = currentColor === 1 ? "black" : "white";
      const deadline = match.turnStartedAt + match.clocksMs[key];
      if (now >= deadline) {
        const timedOutPlayerId = match.turnPlayerId;
        match.clocksMs[key] = 0;
        this.room.match = finishByTimeout(match, timedOutPlayerId, now);
        await this.finishMatch("timeout");
        return;
      }
      for (const [playerId, disconnectedAt] of Object.entries(this.room.disconnectedAt)) {
        if (disconnectedAt && now - disconnectedAt >= DISCONNECT_GRACE_MS) {
          this.room.match = finishByTimeout(match, playerId, now);
          this.room.match.endReason = "disconnect_timeout";
          await this.finishMatch("disconnect_timeout");
          return;
        }
      }
    }
    await this.scheduleNextAlarm();
  }

  async markReady(playerId) {
    if (this.room.status !== "ready") throw new Error("ROOM_NOT_READY");
    this.room.readyByPlayer[playerId] = true;
    if (this.room.readyByPlayer[this.room.hostPlayerId] && this.room.readyByPlayer[this.room.guestPlayerId]) {
      await this.startMatch();
      return;
    }
    await this.ctx.storage.put("room", this.room);
    this.broadcast({type: "room_state", room: this.snapshot(playerId)});
  }

  async startMatch() {
    const host = this.room.hostPlayerId;
    const guest = this.room.guestPlayerId;
    const random = new Uint8Array(1);
    crypto.getRandomValues(random);
    const blackPlayerId = (random[0] & 1) === 0 ? host : guest;
    const whitePlayerId = blackPlayerId === host ? guest : host;
    const matchId = crypto.randomUUID();
    const db = this.env.DB;
    try {
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO pvp_ratings(player_id) VALUES (?)").bind(host),
        db.prepare("INSERT OR IGNORE INTO pvp_ratings(player_id) VALUES (?)").bind(guest),
        db.prepare("INSERT INTO pvp_matches(id,room_id,black_player_id,white_player_id,status,rated,initial_black_rating,initial_white_rating,started_at) VALUES(?,?,?,?,'active',1,(SELECT rating FROM pvp_ratings WHERE player_id=?),(SELECT rating FROM pvp_ratings WHERE player_id=?),datetime('now'))")
          .bind(matchId, this.room.roomId, blackPlayerId, whitePlayerId, blackPlayerId, whitePlayerId),
        db.prepare("INSERT INTO pvp_active_players(player_id,room_id,match_id) VALUES(?,?,?)").bind(blackPlayerId, this.room.roomId, matchId),
        db.prepare("INSERT INTO pvp_active_players(player_id,room_id,match_id) VALUES(?,?,?)").bind(whitePlayerId, this.room.roomId, matchId),
        db.prepare("UPDATE pvp_rooms SET status='active', started_at=datetime('now') WHERE id=? AND status='ready' AND guest_player_id IS NOT NULL").bind(this.room.roomId)
      ]);
    } catch {
      this.broadcast({type: "error", code: "MATCH_START_FAILED", message: "无法开始对局。请确认双方没有其他进行中的真人对局后重试。"});
      return;
    }
    const blackRating = await db.prepare("SELECT rating FROM pvp_ratings WHERE player_id=?").bind(blackPlayerId).first();
    const whiteRating = await db.prepare("SELECT rating FROM pvp_ratings WHERE player_id=?").bind(whitePlayerId).first();
    this.room.status = "active";
    this.room.match = createMatchState({
      roomId: this.room.roomId, matchId, blackPlayerId, whitePlayerId,
      timeControlMs: this.room.timeControlMs, now: nowMs(),
      blackRating: blackRating?.rating ?? 1000, whiteRating: whiteRating?.rating ?? 1000
    });
    await this.ctx.storage.put("room", this.room);
    await this.scheduleNextAlarm();
    this.broadcast({type: "match_started", room: this.snapshot(blackPlayerId)});
  }

  async move(playerId, message) {
    if (this.room.status !== "active" || !this.room.match) throw new Error("MATCH_NOT_ACTIVE");
    const actionId = String(message.actionId || "");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(actionId)) throw new Error("INVALID_ACTION_ID");
    const prior = this.room.match.moves.find(move => move.clientActionId === actionId && move.playerId === playerId);
    if (prior) {
      this.sendToPlayer(playerId, {type: "move_accepted", move: prior, room: this.snapshot(playerId), duplicate: true});
      return;
    }
    const expectedRevision = Number(message.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== this.room.match.revision) throw new Error("STALE_REVISION");
    const oldState = this.room.match;
    let result;
    try {
      result = applyPvpMove(oldState, {
        playerId,
        cellIndex: Number(message.cellIndex),
        actionId,
        now: nowMs()
      });
    } catch (error) {
      if (error.message === "CLOCK_EXPIRED") {
        this.room.match = finishByTimeout(oldState, playerId, nowMs());
        await this.finishMatch("timeout");
        return;
      }
      throw error;
    }
    this.room.match = result.state;
    await this.ctx.storage.put("room", this.room);
    try {
      await this.env.DB.batch([
        this.env.DB.prepare("INSERT INTO pvp_moves(match_id,ply,player_id,color,cell_index,played_at,think_ms,revision,client_action_id) VALUES(?,?,?,?,?,?,?,?,?)")
          .bind(result.state.matchId, result.move.ply, playerId, result.move.color, result.move.cellIndex, new Date(result.move.playedAt).toISOString(), result.move.thinkMs, result.move.revision, actionId),
        this.env.DB.prepare("UPDATE pvp_matches SET move_count=? WHERE id=? AND status='active'")
          .bind(result.state.moves.length, result.state.matchId)
      ]);
    } catch {
      this.room.match = oldState;
      await this.ctx.storage.put("room", this.room);
      throw new Error("MOVE_PERSIST_FAILED");
    }
    if (this.room.match.status === "finished") await this.finishMatch(this.room.match.endReason || "five_in_row");
    else await this.scheduleNextAlarm();
    this.broadcast({type: "move_accepted", move: result.move, winningLine: result.winningLine, room: this.snapshot(playerId)});
  }

  async resign(playerId) {
    if (this.room.status !== "active" || !this.room.match) throw new Error("MATCH_NOT_ACTIVE");
    this.room.match = finishByResign(this.room.match, playerId, nowMs());
    await this.finishMatch("resign");
    this.broadcast({type: "game_over", room: this.snapshot(playerId)});
  }

  async offerDraw(playerId) {
    if (this.room.status !== "active" || !this.room.match) throw new Error("MATCH_NOT_ACTIVE");
    if (this.room.match.pendingDrawBy === playerId) throw new Error("DRAW_ALREADY_OFFERED");
    this.room.match.pendingDrawBy = playerId;
    await this.ctx.storage.put("room", this.room);
    this.broadcast({type: "draw_offered", playerId});
  }

  async acceptDraw(playerId) {
    if (this.room.status !== "active" || !this.room.match) throw new Error("MATCH_NOT_ACTIVE");
    if (!this.room.match.pendingDrawBy || this.room.match.pendingDrawBy === playerId) throw new Error("NO_OPPONENT_DRAW_OFFER");
    this.room.match.status = "finished";
    this.room.match.result = "draw";
    this.room.match.winnerPlayerId = null;
    this.room.match.endReason = "draw_agreement";
    this.room.match.endedAt = nowMs();
    this.room.match.turnPlayerId = null;
    this.room.match.turnColor = null;
    await this.finishMatch("draw_agreement");
    this.broadcast({type: "game_over", room: this.snapshot(playerId)});
  }

  async declineDraw(playerId) {
    if (!this.room.match || this.room.status !== "active") throw new Error("MATCH_NOT_ACTIVE");
    if (!this.room.match.pendingDrawBy || this.room.match.pendingDrawBy === playerId) throw new Error("NO_OPPONENT_DRAW_OFFER");
    this.room.match.pendingDrawBy = null;
    await this.ctx.storage.put("room", this.room);
    this.broadcast({type: "draw_declined", playerId});
  }

  async finishMatch(reason) {
    const match = this.room.match;
    if (!match || match.status !== "finished") return;
    const black = match.blackPlayerId;
    const white = match.whitePlayerId;
    const initialBlack = match.initialRatings[black] ?? 1000;
    const initialWhite = match.initialRatings[white] ?? 1000;
    const elo = calculateElo(initialBlack, initialWhite, match.result);
    const blackOutcome = match.result === "draw" ? "draw" : match.result === "black_win" ? "win" : "loss";
    const whiteOutcome = match.result === "draw" ? "draw" : match.result === "white_win" ? "win" : "loss";
    match.endReason = reason;
    match.finalRatings = {[black]: elo.blackAfter, [white]: elo.whiteAfter};
    this.room.status = "finished";
    this.room.settlementPending = true;
    await this.ctx.storage.put("room", this.room);
    try {
      await this.env.DB.batch([
        this.env.DB.prepare("UPDATE pvp_matches SET status='finished',result=?,end_reason=?,final_black_rating=?,final_white_rating=?,ended_at=datetime('now') WHERE id=? AND status='active'")
          .bind(match.result, reason, elo.blackAfter, elo.whiteAfter, match.matchId),
        this.env.DB.prepare("INSERT OR IGNORE INTO pvp_rating_events(id,match_id,player_id,outcome,rating_before,rating_after,delta) VALUES(?,?,?,?,?,?,?)")
          .bind(crypto.randomUUID(), match.matchId, black, blackOutcome, initialBlack, elo.blackAfter, elo.deltaBlack),
        this.env.DB.prepare("UPDATE pvp_ratings SET rating=?,rated_games=rated_games+1,wins=wins+?,losses=losses+?,draws=draws+?,peak_rating=MAX(peak_rating,?),updated_at=datetime('now') WHERE player_id=? AND changes()=1")
          .bind(elo.blackAfter, blackOutcome === "win" ? 1 : 0, blackOutcome === "loss" ? 1 : 0, blackOutcome === "draw" ? 1 : 0, elo.blackAfter, black),
        this.env.DB.prepare("INSERT OR IGNORE INTO pvp_rating_events(id,match_id,player_id,outcome,rating_before,rating_after,delta) VALUES(?,?,?,?,?,?,?)")
          .bind(crypto.randomUUID(), match.matchId, white, whiteOutcome, initialWhite, elo.whiteAfter, elo.deltaWhite),
        this.env.DB.prepare("UPDATE pvp_ratings SET rating=?,rated_games=rated_games+1,wins=wins+?,losses=losses+?,draws=draws+?,peak_rating=MAX(peak_rating,?),updated_at=datetime('now') WHERE player_id=? AND changes()=1")
          .bind(elo.whiteAfter, whiteOutcome === "win" ? 1 : 0, whiteOutcome === "loss" ? 1 : 0, whiteOutcome === "draw" ? 1 : 0, elo.whiteAfter, white),
        this.env.DB.prepare("DELETE FROM pvp_active_players WHERE match_id=?").bind(match.matchId),
        this.env.DB.prepare("UPDATE pvp_rooms SET status='finished',ended_at=datetime('now') WHERE id=?")
          .bind(this.room.roomId)
      ]);
      this.room.settlementPending = false;
      await this.ctx.storage.put("room", this.room);
      await this.ctx.storage.deleteAlarm();
    } catch {
      await this.ctx.storage.setAlarm(nowMs() + 5000);
      throw new Error("SETTLEMENT_PENDING");
    }
  }
  async scheduleNextAlarm() {
    if (!this.room) return;
    const deadlines = [];
    if (this.room.settlementPending) deadlines.push(nowMs() + 5000);
    if (["waiting", "ready"].includes(this.room.status)) deadlines.push(this.room.expiresAt);
    if (this.room.status === "active" && this.room.match) {
      const match = this.room.match;
      const key = match.turnColor === 1 ? "black" : "white";
      deadlines.push(match.turnStartedAt + match.clocksMs[key]);
      for (const disconnectedAt of Object.values(this.room.disconnectedAt)) {
        if (disconnectedAt) deadlines.push(disconnectedAt + DISCONNECT_GRACE_MS);
      }
    }
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(nowMs() + 100, Math.min(...deadlines)));
    else await this.ctx.storage.deleteAlarm();
  }

  requireMember(playerId) {
    if (!this.isMember(playerId)) {
      const error = new Error("NOT_A_ROOM_MEMBER");
      error.status = 403;
      throw error;
    }
  }

  isMember(playerId) {
    return !!this.room && (playerId === this.room.hostPlayerId || playerId === this.room.guestPlayerId);
  }

  snapshot(viewerPlayerId) {
    if (!this.room) return null;
    const match = this.room.match && this.isMember(viewerPlayerId)
      ? publicMatchState(this.room.match, viewerPlayerId)
      : null;
    return {
      roomId: this.room.roomId,
      status: this.room.status,
      hostPlayerId: this.room.hostPlayerId,
      hostName: this.room.hostName,
      guestPlayerId: this.room.guestPlayerId,
      guestName: this.room.guestName,
      timeControlMs: this.room.timeControlMs,
      rated: this.room.rated,
      createdAt: this.room.createdAt,
      expiresAt: this.room.expiresAt,
      readyByPlayer: this.room.readyByPlayer,
      connectedByPlayer: this.room.connectedByPlayer,
      match
    };
  }

  sendToPlayer(playerId, message) {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() || {};
      if (attachment.playerId === playerId) this.sendTo(socket, message);
    }
  }

  sendTo(socket, message) {
    try { socket.send(JSON.stringify(message)); } catch {}
  }

  broadcast(message) {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() || {};
      const payload = message.room && attachment.playerId
        ? {...message, room: this.snapshot(attachment.playerId)}
        : message;
      this.sendTo(socket, payload);
    }
  }

  errorText(code) {
    const messages = {
      ROOM_NOT_READY: "房间尚未准备好",
      MATCH_NOT_ACTIVE: "当前没有进行中的对局",
      NOT_YOUR_TURN: "还没轮到你落子",
      INVALID_CELL: "落点无效",
      CELL_OCCUPIED: "这个位置已经有棋子",
      INVALID_TURN_STATE: "棋局状态异常，请重新同步",
      CLOCK_EXPIRED: "你的用时已结束",
      INVALID_ACTION_ID: "操作编号无效",
      STALE_REVISION: "棋盘已更新，请同步后重试",
      NOT_A_ROOM_MEMBER: "你不属于这个房间",
      DRAW_ALREADY_OFFERED: "你已经提出和棋",
      NO_OPPONENT_DRAW_OFFER: "当前没有对手提出的和棋请求",
      MOVE_PERSIST_FAILED: "落子保存失败，请重新同步棋盘"
    };
    return messages[code] || "操作失败，请同步棋盘后重试";
  }
}
