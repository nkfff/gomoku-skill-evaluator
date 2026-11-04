import {
  DEFAULT_TIME_CONTROL_MS, UNDO_REQUEST_TIMEOUT_MS,
  acceptPvpDraw, acceptPvpUndo, applyPvpMove, calculateElo, createMatchState,
  cancelPvpDraw, cancelPvpUndo, createPvpIdlePrompt, declinePvpDraw, declinePvpRematch, declinePvpUndo, expirePvpUndo,
  isPvpIdlePromptExpired, offerPvpDraw, offerPvpUndo, pvpIdleReminderDeadline, requestPvpRematch,
  finishByResign, finishByTimeout, publicMatchState, resolvePvpDisconnectState
} from "../src/pvp.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}
});
const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const nowMs = () => Date.now();
const DISCONNECT_GRACE_MS = 60_000;
const WAITING_ROOM_IDLE_MS = 30 * 60_000;
const FINISHED_ROOM_RETENTION_MS = 10 * 60_000;
const CANCELLED_ROOM_RETENTION_MS = 60_000;
const MAX_SPECTATORS = 24;

function secureDie(){
  const limit=Math.floor(0x100000000/6)*6,value=new Uint32Array(1);
  do{crypto.getRandomValues(value);}while(value[0]>=limit);
  return value[0]%6+1;
}
export function hasOpenPlayerConnection(sockets, playerId, excludedSocket = null) {
  return sockets.some(socket => {
    if (socket === excludedSocket || socket.readyState !== 1) return false;
    const attachment = socket.deserializeAttachment() || {};
    return attachment.playerId === playerId && attachment.role !== "spectator";
  });
}

export function hasOpenSpectatorConnection(sockets, spectatorId, excludedSocket = null) {
  return sockets.some(socket => {
    if (socket === excludedSocket || socket.readyState !== 1) return false;
    const attachment = socket.deserializeAttachment() || {};
    return attachment.playerId === spectatorId && attachment.role === "spectator";
  });
}

export function getConnectedSpectators(sockets) {
  const byPlayer = new Map();
  for (const socket of sockets) {
    if (socket.readyState !== 1) continue;
    const attachment = socket.deserializeAttachment() || {};
    if (attachment.role !== "spectator" || !attachment.playerId) continue;
    const name = String(attachment.displayName || "观战者").trim().slice(0, 24) || "观战者";
    byPlayer.set(attachment.playerId, {name});
  }
  return [...byPlayer.values()];
}

export function rollDice(hostPlayerId,guestPlayerId){
  const rolls=[];
  for(let round=1;round<=64;round++){
    const hostRoll=secureDie(),guestRoll=secureDie();
    rolls.push({round,hostRoll,guestRoll});
    if(hostRoll!==guestRoll)return {rolls,winnerPlayerId:hostRoll>guestRoll?hostPlayerId:guestPlayerId};
  }
  throw new Error("DICE_ROLL_FAILED");
}

export class PvpRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.undoPersistenceInFlight = false;
    this.ready = this.ctx.storage.get("room").then(async room => {
      this.room = room || null;
      if (!this.room) return;
      const now = nowMs();
      if (["waiting", "ready"].includes(this.room.status) &&
          (!Number.isFinite(Number(this.room.expiresAt)) || Number(this.room.expiresAt) > now + 365 * 24 * 60 * 60_000)) {
        this.room.expiresAt = now + WAITING_ROOM_IDLE_MS;
      }
      if (this.room.status === "finished" &&
          (!Number.isFinite(Number(this.room.expiresAt)) || Number(this.room.expiresAt) > now + 365 * 24 * 60 * 60_000)) {
        this.room.expiresAt = now + FINISHED_ROOM_RETENTION_MS;
        if (!this.room.resultSeenByPlayer) {
          this.room.resultSeenByPlayer = {
            [this.room.hostPlayerId]: true,
            [this.room.guestPlayerId]: true
          };
        }
      }
      if (this.room.status === "cancelled" &&
          (!Number.isFinite(Number(this.room.expiresAt)) || Number(this.room.expiresAt) > now + 365 * 24 * 60 * 60_000)) {
        this.room.expiresAt = now + CANCELLED_ROOM_RETENTION_MS;
      }
      if (this.room.status === "active" && !Object.prototype.hasOwnProperty.call(this.room, "idleAcknowledgedAt")) {
        this.room.idleAcknowledgedAt = now;
      }
      await this.ctx.storage.put("room", this.room);
      await this.scheduleNextAlarm();
    });
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/internal/init") return await this.initialize(request);
      if (request.method === "POST" && url.pathname === "/internal/init-rematch") return await this.initializeRematch(request);
      if (request.method === "POST" && url.pathname === "/internal/join") return await this.join(request);
      if (request.method === "POST" && url.pathname === "/internal/cancel") return await this.cancel(request);
      if (request.method === "POST" && url.pathname === "/internal/leave") {
        const playerId = request.headers.get("x-player-id") || "";
        await this.leaveRoom(playerId);
        return json({ok: true, status: this.room?.status || "expired"});
      }
      if (request.method === "POST" && url.pathname === "/internal/ack-result") return await this.acknowledgeResult(request);
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
      expiresAt: Number(data.expiresAt) || now + WAITING_ROOM_IDLE_MS,
      lastActivityAt: now,
      readyByPlayer: {},
      rematchByPlayer: {},
      connectedByPlayer: {},
      disconnectedAt: {},
      idlePrompt: null,
      idleAcknowledgedAt: null,
      resultSeenByPlayer: {},
      leftByPlayer: {},
      match: null
    };
    await this.ctx.storage.put("room", this.room);
    await this.scheduleNextAlarm();
    return json({ok: true, roomId: this.room.roomId});
  }

  async initializeRematch(request) {
    const data = await request.json();
    if (this.room) return json({ok: true, roomId: this.room.roomId, status: this.room.status});
    if (!data.roomId || !data.hostPlayerId || !data.guestPlayerId) {
      return json({error: "Invalid rematch initialization"}, 400);
    }
    const now = nowMs();
    this.room = {
      roomId: data.roomId,
      status: "ready",
      hostPlayerId: data.hostPlayerId,
      hostName: data.hostName || "棋手",
      guestPlayerId: data.guestPlayerId,
      guestName: data.guestName || "棋手",
      timeControlMs: Number.isInteger(data.timeControlMs) && data.timeControlMs > 0 ? data.timeControlMs : DEFAULT_TIME_CONTROL_MS,
      rated: true,
      createdAt: now,
      expiresAt: Number(data.expiresAt) || now + WAITING_ROOM_IDLE_MS,
      lastActivityAt: now,
      readyByPlayer: {[data.hostPlayerId]: true, [data.guestPlayerId]: true},
      rematchByPlayer: {},
      connectedByPlayer: {},
      disconnectedAt: {},
      idlePrompt: null,
      idleAcknowledgedAt: null,
      resultSeenByPlayer: {},
      leftByPlayer: {},
      match: null
    };
    await this.ctx.storage.put("room", this.room);
    await this.startMatch();
    return json({ok: true, roomId: this.room.roomId, status: this.room.status});
  }

  async join(request) {
    const data = await request.json();
    if (!this.room) return json({error: "Room not found"}, 404);
    if (this.room.status !== "waiting" || this.room.guestPlayerId) return json({error: "房间已满或不再接受加入"}, 409);
    if (!data.playerId || data.playerId === this.room.hostPlayerId) return json({error: "不能以房主身份重复加入"}, 400);
    this.room.guestPlayerId = data.playerId;
    this.room.guestName = data.playerName || "棋手";
    this.room.status = "ready";
    this.room.readyByPlayer = {};
    this.room.lastActivityAt = nowMs();
    this.room.expiresAt = this.room.lastActivityAt + WAITING_ROOM_IDLE_MS;
    await this.ctx.storage.put("room", this.room);
    await this.env.DB.prepare("UPDATE pvp_rooms SET expires_at=datetime('now','+30 minutes') WHERE id=? AND status='ready'")
      .bind(this.room.roomId).run();
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
    this.room.expiresAt = nowMs() + CANCELLED_ROOM_RETENTION_MS;
    await this.ctx.storage.put("room", this.room);
    await this.env.DB.prepare("UPDATE pvp_rooms SET status='cancelled', expires_at=datetime('now','+60 seconds'), ended_at=datetime('now') WHERE id=? AND status IN ('waiting','ready')").bind(this.room.roomId).run();
    this.broadcast({type: "room_state", room: this.snapshot(playerId)});
    await this.scheduleNextAlarm();
    return json({ok: true, status: "cancelled"});
  }

  async connect(request) {
    if (!this.room) return json({error: "Room not found"}, 404);
    const playerId = request.headers.get("x-player-id") || "";
    const role = request.headers.get("x-role") === "spectator" ? "spectator" : "player";
    if (!["waiting", "ready", "active", "finished"].includes(this.room.status)) {
      return json({error: "房间当前不可连接"}, 409);
    }

    if (role === "spectator") {
      if (this.isMember(playerId)) return json({error: "本房间棋手不能重复以观战者身份进入"}, 409);
      const sockets = this.ctx.getWebSockets();
      if (!hasOpenSpectatorConnection(sockets, playerId) &&
          getConnectedSpectators(sockets).length >= MAX_SPECTATORS) {
        return json({error: "观战人数已达上限，请稍后再试"}, 429);
      }
    } else {
      this.requireMember(playerId);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const displayName = String(request.headers.get("x-player-name") || "观战者").trim().slice(0, 24) || "观战者";
    server.serializeAttachment({playerId, role, displayName});

    if (role === "player") {
      const wasDisconnected = Boolean(this.room.disconnectedAt[playerId]);
      this.room.connectedByPlayer[playerId] = true;
      delete this.room.disconnectedAt[playerId];
      if (this.room.status === "active" &&
          (this.room.idlePrompt?.playerId === playerId ||
           (wasDisconnected && this.room.match?.turnPlayerId === playerId))) {
        this.room.idlePrompt = null;
        this.room.idleAcknowledgedAt = nowMs();
      } else if (["waiting", "ready"].includes(this.room.status)) {
        this.room.lastActivityAt = nowMs();
        this.room.expiresAt = this.room.lastActivityAt + WAITING_ROOM_IDLE_MS;
        await this.env.DB.prepare("UPDATE pvp_rooms SET expires_at=datetime('now','+30 minutes') WHERE id=? AND status IN ('waiting','ready')")
          .bind(this.room.roomId).run();
      }
      await this.ctx.storage.put("room", this.room);
    }

    server.send(JSON.stringify({type: "room_state", room: this.snapshot(playerId, role)}));
    if (role === "spectator") {
      this.broadcast({type: "spectators_updated", spectators: this.spectatorList()});
    } else {
      this.broadcast({type: "presence", playerId, connected: true});
      await this.scheduleNextAlarm();
    }
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
    if (message.type === "ping") {
      this.sendTo(socket, {type: "pong", now: nowMs()});
      return;
    }
    if (attachment.role === "spectator") {
      this.sendTo(socket, {
        type: "error",
        code: "SPECTATOR_READ_ONLY",
        message: "观战模式只读，不能操作棋局。"
      });
      return;
    }
    try {
      this.requireMember(playerId);
      if (this.undoPersistenceInFlight) throw new Error("MATCH_ACTION_IN_PROGRESS");
      if (message.type === "ready") return await this.markReady(playerId);
      if (message.type === "continue_idle") return await this.continueIdle(playerId);
      if (message.type === "ack_result") return await this.acknowledgeResultForPlayer(playerId);
      if (message.type === "leave_room") return await this.leaveRoom(playerId);
      if (message.type === "rematch") return await this.requestRematch(playerId);
      if (message.type === "decline_rematch") return await this.declineRematch(playerId);
      if (message.type === "move") return await this.move(playerId, message);
      if (message.type === "resign") return await this.resign(playerId);
      if (message.type === "offer_draw") return await this.offerDraw(playerId);
      if (message.type === "accept_draw") return await this.acceptDraw(playerId);
      if (message.type === "decline_draw") return await this.declineDraw(playerId);
      if (message.type === "cancel_draw") return await this.cancelDraw(playerId);
      if (message.type === "offer_undo") return await this.offerUndo(playerId);
      if (message.type === "accept_undo") return await this.acceptUndo(playerId);
      if (message.type === "decline_undo") return await this.declineUndo(playerId);
      if (message.type === "cancel_undo") return await this.cancelUndo(playerId);
      this.sendTo(socket, {type: "error", code: "UNKNOWN_ACTION", message: "不支持的操作"});
    } catch (error) {
      this.sendTo(socket, {type: "error", code: error.message || "PVP_ERROR", message: this.errorText(error.message)});
    }
  }

  async webSocketClose(socket) {
    await this.ready;
    const attachment = socket.deserializeAttachment() || {};
    const playerId = attachment.playerId;
    if (!this.room || !playerId) return;

    if (attachment.role === "spectator") {
      const stillConnected = hasOpenSpectatorConnection(this.ctx.getWebSockets(), playerId, socket);
      if (!stillConnected) {
        this.broadcast({type: "spectators_updated", spectators: this.spectatorList()});
      }
      return;
    }
    if (!this.isMember(playerId)) return;

    // A refresh may establish a replacement socket before the old socket's
    // close event arrives. Keep the player online while another live socket exists.
    const stillConnected = hasOpenPlayerConnection(this.ctx.getWebSockets(), playerId, socket);
    this.room.connectedByPlayer[playerId] = stillConnected;
    if (stillConnected) {
      delete this.room.disconnectedAt[playerId];
    } else {
      this.room.disconnectedAt[playerId] = nowMs();
      this.room.idlePrompt = null;
      this.room.idleAcknowledgedAt = nowMs();
    }
    await this.ctx.storage.put("room", this.room);
    if (!stillConnected) {
      this.broadcast({type: "presence", playerId, connected: false, graceMs: DISCONNECT_GRACE_MS});
    }
    await this.scheduleNextAlarm();
  }

  async webSocketError(socket) {
    return this.webSocketClose(socket);
  }

  async alarm() {
    await this.ready;
    if (!this.room) return;
    if (this.undoPersistenceInFlight) {
      await this.ctx.storage.setAlarm(nowMs() + 250);
      return;
    }
    const now = nowMs();
    if (this.room.status === "expired" && this.room.expirationPending) {
      await this.expireRoom(this.room.expiredReason || "expired");
      return;
    }
    if (this.room.status === "finished" && this.room.settlementPending && this.room.match) {
      if (this.room.unratedAbortPending) await this.finishAbandonedMatch();
      else await this.finishMatch(this.room.match.endReason || "five_in_row");
      return;
    }
    if (["waiting", "ready", "finished", "cancelled"].includes(this.room.status) &&
        Number.isFinite(Number(this.room.expiresAt)) && now >= Number(this.room.expiresAt)) {
      await this.expireRoom(this.room.status === "finished" ? "finished_retention" : "room_idle");
      return;
    }
    if (this.room.status === "active" && this.room.match) {
      const match = this.room.match;
      const disconnectState = resolvePvpDisconnectState(
        [this.room.hostPlayerId, this.room.guestPlayerId],
        this.room.disconnectedAt || {},
        now,
        DISCONNECT_GRACE_MS
      );
      if (disconnectState.type === "abandon") {
        await this.finishAbandonedMatch();
        return;
      }
      // When both players are offline, let the second player's full reconnect
      // grace period elapse before deciding the match is abandoned. The chess
      // clock and idle reminder must not award a win during this shared outage.
      if (disconnectState.type === "wait" && disconnectState.both) {
        await this.scheduleNextAlarm();
        return;
      }

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
      if (match.pendingUndo && now >= match.pendingUndo.requestedAt + UNDO_REQUEST_TIMEOUT_MS) {
        const requesterPlayerId = match.pendingUndo.requesterPlayerId;
        this.room.match = expirePvpUndo(match, now);
        this.room.idlePrompt = null;
        this.room.idleAcknowledgedAt = now;
        await this.ctx.storage.put("room", this.room);
        this.broadcast({type: "undo_expired", requesterPlayerId, room: true});
      }
      if (disconnectState.type === "forfeit") {
        this.room.match = finishByTimeout(match, disconnectState.playerId, now);
        this.room.match.endReason = "disconnect_timeout";
        await this.finishMatch("disconnect_timeout");
        return;
      }

      const hasDisconnectedPlayer = disconnectState.type === "wait";
      if (!hasDisconnectedPlayer && !match.pendingUndo && !match.pendingDrawBy) {
        if (this.room.idlePrompt && isPvpIdlePromptExpired(this.room.idlePrompt, now)) {
          const idlePlayerId = this.room.idlePrompt.playerId;
          this.room.match = finishByTimeout(match, idlePlayerId, now);
          await this.finishMatch("idle_timeout");
          return;
        }
        if (!this.room.idlePrompt) {
          const reminderAt = pvpIdleReminderDeadline(match, this.room.idleAcknowledgedAt);
          if (reminderAt !== null && now >= reminderAt) {
            this.room.idlePrompt = createPvpIdlePrompt(match.turnPlayerId, now);
            await this.ctx.storage.put("room", this.room);
            this.broadcast({type: "idle_prompt", playerId: match.turnPlayerId, room: this.snapshot(match.turnPlayerId)});
          }
        }
      }
    }
    await this.scheduleNextAlarm();
  }

  async continueIdle(playerId) {
    if (this.room.status !== "active" || !this.room.match) throw new Error("MATCH_NOT_ACTIVE");
    const prompt = this.room.idlePrompt;
    if (!prompt || prompt.playerId !== playerId) throw new Error("NO_IDLE_PROMPT_FOR_PLAYER");
    const now = nowMs();
    if (isPvpIdlePromptExpired(prompt, now)) {
      this.room.match = finishByTimeout(this.room.match, playerId, now);
      await this.finishMatch("idle_timeout");
      return;
    }
    this.room.idlePrompt = null;
    this.room.idleAcknowledgedAt = now;
    await this.ctx.storage.put("room", this.room);
    await this.scheduleNextAlarm();
    this.broadcast({type: "idle_dismissed", playerId, room: true});
  }

  async acknowledgeResultForPlayer(playerId) {
    this.requireMember(playerId);
    if (this.room.status !== "finished" || !this.room.match) throw new Error("MATCH_NOT_FINISHED");
    this.room.resultSeenByPlayer = {
      ...(this.room.resultSeenByPlayer || {}),
      [playerId]: true
    };
    await this.ctx.storage.put("room", this.room);
    this.broadcast({type: "result_acknowledged", playerId, room: true});
  }

  async acknowledgeResult(request) {
    const playerId = request.headers.get("x-player-id") || "";
    await this.acknowledgeResultForPlayer(playerId);
    return json({ok: true});
  }

  async leaveRoom(playerId) {
    this.requireMember(playerId);
    if (this.room.status !== "finished") throw new Error("MATCH_NOT_FINISHED");
    this.room.leftByPlayer = {...(this.room.leftByPlayer || {}), [playerId]: true};
    await this.ctx.storage.put("room", this.room);
    if (this.room.leftByPlayer[this.room.hostPlayerId] && this.room.leftByPlayer[this.room.guestPlayerId]) {
      await this.expireRoom("both_players_left");
      return;
    }
    await this.scheduleNextAlarm();
    this.broadcast({type: "player_left_room", playerId, room: true});
  }

  async finishAbandonedMatch() {
    const match = this.room && this.room.match;
    if (!match || (!this.room.unratedAbortPending && match.status !== "active")) return;
    if (!this.room.unratedAbortPending) {
      const now = nowMs();
      match.status = "finished";
      match.result = null;
      match.winnerPlayerId = null;
      match.endReason = "both_disconnected";
      match.endedAt = now;
      match.turnPlayerId = null;
      match.turnColor = null;
      match.pendingDrawBy = null;
      match.pendingUndo = null;
      match.finalRatings = null;
      this.room.status = "finished";
      this.room.idlePrompt = null;
      this.room.rematchByPlayer = {};
      this.room.settlementPending = true;
      this.room.unratedAbortPending = true;
      this.room.expiresAt = now + FINISHED_ROOM_RETENTION_MS;
      this.room.resultSeenByPlayer = {
        [this.room.hostPlayerId]: false,
        [this.room.guestPlayerId]: false
      };
      await this.ctx.storage.put("room", this.room);
    }
    try {
      await this.env.DB.batch([
        this.env.DB.prepare("UPDATE pvp_matches SET status='finished',result=NULL,end_reason='disconnect_timeout',end_reason_detail='both_disconnected',ended_at=datetime('now') WHERE id=? AND status='active'")
          .bind(match.matchId),
        this.env.DB.prepare("DELETE FROM pvp_active_players WHERE match_id=?").bind(match.matchId),
        this.env.DB.prepare("UPDATE pvp_rooms SET status='finished',expires_at=datetime('now','+10 minutes'),ended_at=datetime('now') WHERE id=?")
          .bind(this.room.roomId)
      ]);
      this.room.settlementPending = false;
      this.room.unratedAbortPending = false;
      await this.ctx.storage.put("room", this.room);
      await this.scheduleNextAlarm();
    } catch {
      await this.ctx.storage.setAlarm(nowMs() + 5000);
      throw new Error("SETTLEMENT_PENDING");
    }
    this.broadcast({type: "game_abandoned", room: this.snapshot(match.blackPlayerId)});
  }

  async expireRoom(reason = "expired") {
    if (!this.room) return;
    this.room.status = "expired";
    this.room.expirationPending = true;
    this.room.expiredReason = reason;
    await this.ctx.storage.put("room", this.room);
    try {
      await this.env.DB.prepare(
        "UPDATE pvp_rooms SET status='expired',expires_at=datetime('now'),ended_at=COALESCE(ended_at,datetime('now')) WHERE id=? AND status IN ('waiting','ready','finished','cancelled','expired')"
      ).bind(this.room.roomId).run();
      this.broadcast({type: "room_state", room: this.snapshot(this.room.hostPlayerId)});
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.close(1000, "PVP room expired"); } catch {}
      }
      await this.ctx.storage.delete("room");
      await this.ctx.storage.deleteAlarm();
      this.room = null;
    } catch {
      await this.ctx.storage.setAlarm(nowMs() + 5000);
      throw new Error("ROOM_EXPIRY_PENDING");
    }
  }

  async markReady(playerId) {
    if (this.room.status !== "ready") throw new Error("ROOM_NOT_READY");
    this.room.readyByPlayer[playerId] = true;
    this.room.lastActivityAt = nowMs();
    this.room.expiresAt = this.room.lastActivityAt + WAITING_ROOM_IDLE_MS;
    if (this.room.readyByPlayer[this.room.hostPlayerId] && this.room.readyByPlayer[this.room.guestPlayerId]) {
      await this.startMatch();
      return;
    }
    await this.ctx.storage.put("room", this.room);
    await this.env.DB.prepare("UPDATE pvp_rooms SET expires_at=datetime('now','+30 minutes') WHERE id=? AND status='ready'")
      .bind(this.room.roomId).run();
    await this.scheduleNextAlarm();
    this.broadcast({type: "room_state", room: this.snapshot(playerId)});
  }

  async requestRematch(playerId) {
    if (this.room.settlementPending) throw new Error("SETTLEMENT_PENDING");
    if (this.room.rematchRoomId || this.room.rematchStarting) throw new Error("REMATCH_ALREADY_STARTED");
    const request = requestPvpRematch(this.room, playerId);
    if (!request.acceptedByBoth) {
      this.room = request.room;
      if (this.room.status === "finished") {
        this.room.expiresAt = nowMs() + FINISHED_ROOM_RETENTION_MS;
        await this.env.DB.prepare("UPDATE pvp_rooms SET expires_at=datetime('now','+10 minutes') WHERE id=? AND status='finished'")
          .bind(this.room.roomId).run();
      }
      await this.ctx.storage.put("room", this.room);
      await this.scheduleNextAlarm();
      if (this.room.status === "finished" && !this.room.rematchRoomId) {
        this.broadcast({type: "rematch_requested", playerId, room: this.snapshot(playerId)});
      }
      return;
    }

    const otherPlayerId = playerId === this.room.hostPlayerId ? this.room.guestPlayerId : this.room.hostPlayerId;
    this.room.rematchByPlayer = {...(this.room.rematchByPlayer || {}), [playerId]: true};
    this.room.expiresAt = nowMs() + FINISHED_ROOM_RETENTION_MS;
    this.room.rematchStarting = true;
    this.room.rematchStartingAt = nowMs();
    await this.env.DB.prepare("UPDATE pvp_rooms SET expires_at=datetime('now','+10 minutes') WHERE id=? AND status='finished'")
      .bind(this.room.roomId).run();
    await this.ctx.storage.put("room", this.room);
    this.broadcast({type: "rematch_starting", playerId, room: this.snapshot(playerId)});

    const newRoomId = crypto.randomUUID();
    try {
      const randomBytes = crypto.getRandomValues(new Uint8Array(32));
      const inviteCodeHash = [...randomBytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const expiresAt = nowMs() + WAITING_ROOM_IDLE_MS;
      await this.env.DB.prepare(
        "INSERT INTO pvp_rooms(id,host_player_id,guest_player_id,invite_code_hash,status,time_control_ms,rated,expires_at) VALUES(?,?,?,?,'ready',?,1,datetime('now','+30 minutes'))"
      ).bind(
        newRoomId, this.room.hostPlayerId, this.room.guestPlayerId,
        inviteCodeHash, this.room.timeControlMs
      ).run();

      const stub = this.env.PVP_ROOMS.get(this.env.PVP_ROOMS.idFromName(newRoomId));
      let newRoomActive = false;
      try {
        const response = await stub.fetch(new Request("https://pvp-room/internal/init-rematch", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            roomId: newRoomId,
            hostPlayerId: this.room.hostPlayerId,
            hostName: this.room.hostName,
            guestPlayerId: this.room.guestPlayerId,
            guestName: this.room.guestName,
            timeControlMs: this.room.timeControlMs,
            expiresAt
          })
        }));
        const data = await response.json().catch(() => ({}));
        newRoomActive = response.ok && data.status === "active";
      } catch {
        newRoomActive = false;
      }
      if (!newRoomActive) {
        try {
          const stateResponse = await stub.fetch(new Request("https://pvp-room/internal/state", {
            headers: {"x-player-id": this.room.hostPlayerId}
          }));
          const state = await stateResponse.json().catch(() => ({}));
          newRoomActive = stateResponse.ok && state.status === "active" && state.match?.status === "active";
        } catch {
          newRoomActive = false;
        }
      }
      if (!newRoomActive) throw new Error("REMATCH_START_FAILED");
    } catch {
      this.room.rematchStarting = false;
      this.room.rematchStartingAt = null;
      this.room.rematchByPlayer = {[otherPlayerId]: true};
      await this.ctx.storage.put("room", this.room);
      try {
        await this.env.DB.prepare(
          "UPDATE pvp_rooms SET status='cancelled',ended_at=datetime('now') WHERE id=? AND status IN ('ready','active')"
        ).bind(newRoomId).run();
      } catch {}
      this.broadcast({type: "rematch_failed", playerId, room: this.snapshot(playerId)});
      throw new Error("REMATCH_START_FAILED");
    }

    this.room.rematchByPlayer = {};
    this.room.rematchStarting = false;
    this.room.rematchStartingAt = null;
    this.room.rematchRoomId = newRoomId;
    await this.ctx.storage.put("room", this.room);
    this.broadcast({type: "rematch_started", newRoomId});
  }
  async declineRematch(playerId) {
    if (this.room.settlementPending) throw new Error("SETTLEMENT_PENDING");
    this.room = declinePvpRematch(this.room, playerId);
    await this.ctx.storage.put("room", this.room);
    this.broadcast({type: "rematch_declined", playerId, room: this.snapshot(playerId)});
  }

  async startMatch() {
    const host = this.room.hostPlayerId;
    const guest = this.room.guestPlayerId;
    const dice = rollDice(host, guest);
    const blackPlayerId = dice.winnerPlayerId;
    const whitePlayerId = blackPlayerId === host ? guest : host;
    const matchId = crypto.randomUUID();
    const db = this.env.DB;
    try {
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO pvp_ratings(player_id) VALUES (?)").bind(host),
        db.prepare("INSERT OR IGNORE INTO pvp_ratings(player_id) VALUES (?)").bind(guest),
        db.prepare("INSERT INTO pvp_matches(id,room_id,black_player_id,white_player_id,status,rated,initial_black_rating,initial_white_rating,started_at,dice_rolls,dice_winner_player_id) VALUES(?,?,?,?,'active',1,(SELECT rating FROM pvp_ratings WHERE player_id=?),(SELECT rating FROM pvp_ratings WHERE player_id=?),datetime('now'),?,?)")
          .bind(matchId, this.room.roomId, blackPlayerId, whitePlayerId, blackPlayerId, whitePlayerId, JSON.stringify(dice.rolls), dice.winnerPlayerId),
        db.prepare("INSERT INTO pvp_active_players(player_id,room_id,match_id) VALUES(?,?,?)").bind(blackPlayerId, this.room.roomId, matchId),
        db.prepare("INSERT INTO pvp_active_players(player_id,room_id,match_id) VALUES(?,?,?)").bind(whitePlayerId, this.room.roomId, matchId),
        db.prepare("UPDATE pvp_rooms SET status='active', started_at=datetime('now') WHERE id=? AND status='ready' AND guest_player_id IS NOT NULL").bind(this.room.roomId)
      ]);
    } catch {
      this.room.status = "ready";
      this.room.readyByPlayer = {};
      await this.ctx.storage.put("room", this.room);
      this.broadcast({
        type: "error",
        code: "MATCH_START_FAILED",
        message: "无法开始对局。请确认双方没有其他进行中的真人对局后重试。",
        room: this.snapshot(this.room.hostPlayerId)
      });
      return;
    }
    const blackRating = await db.prepare("SELECT rating FROM pvp_ratings WHERE player_id=?").bind(blackPlayerId).first();
    const whiteRating = await db.prepare("SELECT rating FROM pvp_ratings WHERE player_id=?").bind(whitePlayerId).first();
    this.room.status = "active";
    this.room.match = createMatchState({
      roomId: this.room.roomId, matchId, blackPlayerId, whitePlayerId,
      timeControlMs: this.room.timeControlMs, now: nowMs(),
      blackRating: blackRating?.rating ?? 1000, whiteRating: whiteRating?.rating ?? 1000,
      diceRolls: dice.rolls, diceWinnerPlayerId: dice.winnerPlayerId
    });
    this.room.idlePrompt = null;
    this.room.idleAcknowledgedAt = null;
    this.room.resultSeenByPlayer = {[host]: false, [guest]: false};
    this.room.leftByPlayer = {};
    this.room.disconnectedAt = {};
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
    this.room.idlePrompt = null;
    this.room.idleAcknowledgedAt = null;
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
    this.broadcast({type: "move_accepted", move: result.move, winningLine: result.winningLine, room: true});
  }

  async resign(playerId) {
    if (this.room.status !== "active" || !this.room.match) throw new Error("MATCH_NOT_ACTIVE");
    this.room.match = finishByResign(this.room.match, playerId, nowMs());
    await this.finishMatch("resign");
  }

  async offerDraw(playerId) {
    if (this.room.status !== "active" || !this.room.match) throw new Error("MATCH_NOT_ACTIVE");
    this.room.match = offerPvpDraw(this.room.match, playerId);
    this.room.idlePrompt = null;
    this.room.idleAcknowledgedAt = nowMs();
    await this.ctx.storage.put("room", this.room);
    await this.scheduleNextAlarm();
    this.broadcast({type: "draw_offered", playerId, room: this.snapshot(playerId)});
  }

  async acceptDraw(playerId) {
    if (this.room.status !== "active" || !this.room.match) throw new Error("MATCH_NOT_ACTIVE");
    this.room.match = acceptPvpDraw(this.room.match, playerId, nowMs());
    await this.finishMatch("draw_agreement");
  }

  async declineDraw(playerId) {
    if (this.room.status !== "active" || !this.room.match) throw new Error("MATCH_NOT_ACTIVE");
    this.room.match = declinePvpDraw(this.room.match, playerId);
    this.room.idlePrompt = null;
    this.room.idleAcknowledgedAt = nowMs();
    await this.ctx.storage.put("room", this.room);
    await this.scheduleNextAlarm();
    this.broadcast({type: "draw_declined", playerId, room: this.snapshot(playerId)});
  }

  async cancelDraw(playerId) {
    if (this.room.status !== "active" || !this.room.match) throw new Error("MATCH_NOT_ACTIVE");
    this.room.match = cancelPvpDraw(this.room.match, playerId);
    this.room.idlePrompt = null;
    this.room.idleAcknowledgedAt = nowMs();
    await this.ctx.storage.put("room", this.room);
    await this.scheduleNextAlarm();
    this.broadcast({type: "draw_cancelled", playerId, room: this.snapshot(playerId)});
  }

  async offerUndo(playerId) {
    if (this.room.status !== "active" || !this.room.match) throw new Error("MATCH_NOT_ACTIVE");
    this.room.match = offerPvpUndo(this.room.match, playerId, nowMs());
    this.room.idlePrompt = null;
    this.room.idleAcknowledgedAt = nowMs();
    await this.ctx.storage.put("room", this.room);
    await this.scheduleNextAlarm();
    this.broadcast({type: "undo_requested", playerId, room: true});
  }

  async acceptUndo(playerId) {
    if (this.room.status !== "active" || !this.room.match) throw new Error("MATCH_NOT_ACTIVE");
    if (this.undoPersistenceInFlight) throw new Error("MATCH_ACTION_IN_PROGRESS");
    this.undoPersistenceInFlight = true;
    try {
      if (this.room.status !== "active" || !this.room.match) throw new Error("MATCH_NOT_ACTIVE");
      const oldState = this.room.match;
      const removedMove = oldState.moves[oldState.moves.length - 1];
      let nextState;
      try {
        nextState = acceptPvpUndo(oldState, playerId, nowMs());
      } catch (error) {
        if (error.message === "CLOCK_EXPIRED") {
          this.room.match = finishByTimeout(oldState, oldState.turnPlayerId, nowMs());
          await this.finishMatch("timeout");
          return;
        }
        throw error;
      }
      this.room.match = nextState;
      this.room.idlePrompt = null;
      this.room.idleAcknowledgedAt = null;
      await this.ctx.storage.put("room", this.room);
      try {
        const results = await this.env.DB.batch([
          this.env.DB.prepare(
            "DELETE FROM pvp_moves WHERE match_id=? AND ply=? AND player_id=? AND revision=? AND EXISTS(SELECT 1 FROM pvp_matches WHERE id=? AND status='active')"
          ).bind(oldState.matchId, removedMove.ply, removedMove.playerId, removedMove.revision, oldState.matchId),
          this.env.DB.prepare(
            "UPDATE pvp_matches SET move_count=? WHERE id=? AND status='active' AND changes()=1"
          ).bind(nextState.moves.length, oldState.matchId)
        ]);
        if (Number(results?.[0]?.meta?.changes || 0) !== 1 ||
            Number(results?.[1]?.meta?.changes || 0) !== 1) {
          throw new Error("UNDO_PERSIST_FAILED");
        }
      } catch {
        this.room.match = oldState;
        await this.ctx.storage.put("room", this.room);
        throw new Error("UNDO_PERSIST_FAILED");
      }
      await this.scheduleNextAlarm();
      this.broadcast({type: "undo_accepted", playerId, removedMove, room: true});
    } finally {
      this.undoPersistenceInFlight = false;
    }
  }

  async declineUndo(playerId) {
    if (this.room.status !== "active" || !this.room.match) throw new Error("MATCH_NOT_ACTIVE");
    this.room.match = declinePvpUndo(this.room.match, playerId);
    this.room.idlePrompt = null;
    this.room.idleAcknowledgedAt = nowMs();
    await this.ctx.storage.put("room", this.room);
    await this.scheduleNextAlarm();
    this.broadcast({type: "undo_declined", playerId, room: true});
  }

  async cancelUndo(playerId) {
    if (this.room.status !== "active" || !this.room.match) throw new Error("MATCH_NOT_ACTIVE");
    this.room.match = cancelPvpUndo(this.room.match, playerId);
    this.room.idlePrompt = null;
    this.room.idleAcknowledgedAt = nowMs();
    await this.ctx.storage.put("room", this.room);
    await this.scheduleNextAlarm();
    this.broadcast({type: "undo_cancelled", playerId, room: true});
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
    const dbReason = reason === "idle_timeout" ? "timeout" : reason;
    const detailReason = reason === "idle_timeout" ? "idle_timeout" : null;
    match.endReason = reason;
    match.endReasonDetail = detailReason;
    match.finalRatings = {[black]: elo.blackAfter, [white]: elo.whiteAfter};
    this.room.status = "finished";
    this.room.idlePrompt = null;
    this.room.rematchByPlayer = {};
    this.room.settlementPending = true;
    this.room.unratedAbortPending = false;
    this.room.expiresAt = nowMs() + FINISHED_ROOM_RETENTION_MS;
    this.room.resultSeenByPlayer = {
      ...(this.room.resultSeenByPlayer || {}),
      [this.room.hostPlayerId]: this.room.resultSeenByPlayer?.[this.room.hostPlayerId] ?? false,
      [this.room.guestPlayerId]: this.room.resultSeenByPlayer?.[this.room.guestPlayerId] ?? false
    };
    await this.ctx.storage.put("room", this.room);
    try {
      await this.env.DB.batch([
        this.env.DB.prepare("UPDATE pvp_matches SET status='finished',result=?,end_reason=?,end_reason_detail=?,final_black_rating=?,final_white_rating=?,ended_at=datetime('now') WHERE id=? AND status='active'")
          .bind(match.result, dbReason, detailReason, elo.blackAfter, elo.whiteAfter, match.matchId),
        this.env.DB.prepare("INSERT OR IGNORE INTO pvp_rating_events(id,match_id,player_id,outcome,rating_before,rating_after,delta) VALUES(?,?,?,?,?,?,?)")
          .bind(crypto.randomUUID(), match.matchId, black, blackOutcome, initialBlack, elo.blackAfter, elo.deltaBlack),
        this.env.DB.prepare("UPDATE pvp_ratings SET rating=?,rated_games=rated_games+1,wins=wins+?,losses=losses+?,draws=draws+?,peak_rating=MAX(peak_rating,?),updated_at=datetime('now') WHERE player_id=? AND changes()=1")
          .bind(elo.blackAfter, blackOutcome === "win" ? 1 : 0, blackOutcome === "loss" ? 1 : 0, blackOutcome === "draw" ? 1 : 0, elo.blackAfter, black),
        this.env.DB.prepare("INSERT OR IGNORE INTO pvp_rating_events(id,match_id,player_id,outcome,rating_before,rating_after,delta) VALUES(?,?,?,?,?,?,?)")
          .bind(crypto.randomUUID(), match.matchId, white, whiteOutcome, initialWhite, elo.whiteAfter, elo.deltaWhite),
        this.env.DB.prepare("UPDATE pvp_ratings SET rating=?,rated_games=rated_games+1,wins=wins+?,losses=losses+?,draws=draws+?,peak_rating=MAX(peak_rating,?),updated_at=datetime('now') WHERE player_id=? AND changes()=1")
          .bind(elo.whiteAfter, whiteOutcome === "win" ? 1 : 0, whiteOutcome === "loss" ? 1 : 0, whiteOutcome === "draw" ? 1 : 0, elo.whiteAfter, white),
        this.env.DB.prepare("DELETE FROM pvp_active_players WHERE match_id=?").bind(match.matchId),
        this.env.DB.prepare("UPDATE pvp_rooms SET status='finished',expires_at=datetime('now','+10 minutes'),ended_at=datetime('now') WHERE id=?")
          .bind(this.room.roomId)
      ]);
      this.room.settlementPending = false;
      await this.ctx.storage.put("room", this.room);
      await this.scheduleNextAlarm();
    } catch {
      await this.ctx.storage.setAlarm(nowMs() + 5000);
      throw new Error("SETTLEMENT_PENDING");
    }
    this.broadcast({type: "game_over", room: this.snapshot(match.blackPlayerId)});
  }
  async scheduleNextAlarm() {
    if (!this.room) return;
    const deadlines = [];
    if (this.room.settlementPending) deadlines.push(nowMs() + 5000);
    if (this.room.status === "active" && this.room.match) {
      const match = this.room.match;
      const disconnectedAt = [
        this.room.disconnectedAt?.[this.room.hostPlayerId],
        this.room.disconnectedAt?.[this.room.guestPlayerId]
      ].filter(timestamp => typeof timestamp === "number" && Number.isFinite(timestamp));
      if (disconnectedAt.length === 2) {
        // The shared disconnect window is authoritative. Do not wake repeatedly
        // on a chess clock that has already expired while both players are away.
        deadlines.push(Math.max(...disconnectedAt) + DISCONNECT_GRACE_MS);
      } else {
        const key = match.turnColor === 1 ? "black" : "white";
        deadlines.push(match.turnStartedAt + match.clocksMs[key]);
        if (match.pendingUndo) deadlines.push(match.pendingUndo.requestedAt + UNDO_REQUEST_TIMEOUT_MS);
        for (const timestamp of disconnectedAt) deadlines.push(timestamp + DISCONNECT_GRACE_MS);
      }
      if (!disconnectedAt.length && !match.pendingUndo && !match.pendingDrawBy) {
        if (this.room.idlePrompt) deadlines.push(Number(this.room.idlePrompt.deadlineAt));
        else {
          const reminderAt = pvpIdleReminderDeadline(match, this.room.idleAcknowledgedAt);
          if (reminderAt !== null) deadlines.push(reminderAt);
        }
      }
    } else if (["waiting", "ready", "finished", "cancelled"].includes(this.room.status) &&
               Number.isFinite(Number(this.room.expiresAt))) {
      deadlines.push(Number(this.room.expiresAt));
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

  spectatorList(sockets = this.ctx.getWebSockets()) {
    return getConnectedSpectators(sockets);
  }

  snapshot(viewerPlayerId, viewerRole = "player", spectators = this.spectatorList()) {
    if (!this.room) return null;
    const isPlayer = this.isMember(viewerPlayerId);
    const canViewMatch = isPlayer || viewerRole === "spectator";
    const match = this.room.match && canViewMatch
      ? publicMatchState(this.room.match, viewerPlayerId, {spectator: !isPlayer})
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
      rematchByPlayer: this.room.rematchByPlayer || {},
      rematchRoomId: this.room.rematchRoomId || null,
      rematchStarting: Boolean(this.room.rematchStarting),
      connectedByPlayer: this.room.connectedByPlayer,
      idlePrompt: this.room.idlePrompt || null,
      resultSeenByPlayer: this.room.resultSeenByPlayer || {},
      leftByPlayer: this.room.leftByPlayer || {},
      spectators,
      spectatorCount: spectators.length,
      match
    };
  }

  sendToPlayer(playerId, message) {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() || {};
      if (attachment.playerId === playerId && attachment.role !== "spectator") this.sendTo(socket, message);
    }
  }

  sendTo(socket, message) {
    try { socket.send(JSON.stringify(message)); } catch {}
  }

  broadcast(message) {
    const sockets = this.ctx.getWebSockets();
    const spectators = this.spectatorList(sockets);
    const snapshots = new Map();
    const encodedPayloads = new Map();
    for (const socket of sockets) {
      const attachment = socket.deserializeAttachment() || {};
      let payload = message;
      let cacheKey = "shared";
      if (message.type === "move_accepted" && attachment.role === "spectator" && this.room?.match) {
        const match = this.room.match;
        cacheKey = "spectator";
        payload = {
          type: "spectator_move",
          move: message.move,
          patch: {
            roomStatus: this.room.status,
            matchId: match.matchId,
            status: match.status,
            revision: match.revision,
            turnPlayerId: match.turnPlayerId,
            turnColor: match.turnColor,
            turnStartedAt: match.turnStartedAt,
            clocksMs: match.clocksMs,
            pendingDrawBy: match.pendingDrawBy,
            result: match.result,
            winnerPlayerId: match.winnerPlayerId,
            endReason: match.endReason,
            endedAt: match.endedAt
          }
        };
      } else if (message.room && attachment.playerId) {
        const role = attachment.role === "spectator" ? "spectator" : "player";
        cacheKey = role === "spectator" ? "spectator" : "player:" + attachment.playerId;
        if (!snapshots.has(cacheKey)) {
          snapshots.set(cacheKey, this.snapshot(attachment.playerId, role, spectators));
        }
        payload = {...message, room: snapshots.get(cacheKey)};
      }
      if (!encodedPayloads.has(cacheKey)) encodedPayloads.set(cacheKey, JSON.stringify(payload));
      try { socket.send(encodedPayloads.get(cacheKey)); } catch {}
    }
  }

  errorText(code) {
    const messages = {
      ROOM_NOT_READY: "房间尚未准备好",
      ROOM_NOT_FINISHED: "本局尚未结束，暂时不能再来一局",
      SETTLEMENT_PENDING: "本局结算尚未完成，请稍后再试",
      REMATCH_START_FAILED: "新对局创建失败，请重试再来一局",
      REMATCH_ALREADY_STARTED: "双方已确认再战，正在进入新对局",
      MATCH_NOT_ACTIVE: "当前没有进行中的对局",
      NOT_YOUR_TURN: "还没轮到你落子",
      INVALID_CELL: "落点无效",
      CELL_OCCUPIED: "这个位置已经有棋子",
      INVALID_TURN_STATE: "棋局状态异常，请重新同步",
      CLOCK_EXPIRED: "你的用时已结束",
      INVALID_ACTION_ID: "操作编号无效",
      STALE_REVISION: "棋盘已更新，请同步后重试",
      NOT_A_ROOM_MEMBER: "你不属于这个房间",
      DRAW_ALREADY_OFFERED: "你已经提出和棋，请等待对手回应",
      DRAW_ALREADY_PENDING: "对手已经提出和棋，请选择接受或拒绝",
      NO_OPPONENT_DRAW_OFFER: "当前没有对手提出的和棋请求",
      NO_PENDING_DRAW_REQUEST: "当前没有待处理的和棋申请",
      NOT_DRAW_REQUESTER: "只有申请方可以撤回和棋请求",
      NO_MOVE_TO_UNDO: "当前还没有可以撤回的落子",
      UNDO_ALREADY_PENDING: "已有悔棋申请，请先处理",
      NO_PENDING_UNDO_REQUEST: "当前没有待处理的悔棋申请",
      UNDO_REQUEST_EXPIRED: "悔棋申请已超时，请重新同步棋盘",
      CANNOT_ACCEPT_OWN_UNDO: "不能接受自己发起的悔棋申请",
      CANNOT_DECLINE_OWN_UNDO: "不能拒绝自己发起的悔棋申请",
      NOT_UNDO_REQUESTER: "只有悔棋申请方可以撤回申请",
      STALE_UNDO_REQUEST: "悔棋申请已失效，请重新同步棋盘",
      UNDO_PERSIST_FAILED: "悔棋记录保存失败，棋盘已恢复，请重试",
      MATCH_ACTION_IN_PROGRESS: "悔棋正在同步棋谱，请稍候再操作",
      NO_PENDING_REMATCH_INVITE: "当前没有待处理的再来一局邀请",
      MOVE_PERSIST_FAILED: "落子保存失败，请重新同步棋盘"
    };
    return messages[code] || "操作失败，请同步棋盘后重试";
  }
}
