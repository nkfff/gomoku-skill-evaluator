import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../src/app.js",import.meta.url),"utf8");
const pvp=readFileSync(new URL("../pvp-ui.js",import.meta.url),"utf8");
const offline=readFileSync(new URL("../src/offline-cache.js",import.meta.url),"utf8");

test("AI match remains independent of authentication callbacks",()=>{
  const authCallback=app.slice(app.indexOf("initAccount(async signedIn"),app.indexOf("localRank();setInterval(formatTime",app.indexOf("initAccount(async signedIn")));
  assert.doesNotMatch(authCallback,/await newGame\(/);
});
test("AI game is persisted and restored across reload",()=>{
  assert.match(app,/const ACTIVE_GAME_STORE=/);
  assert.match(app,/localStorage\.setItem\(ACTIVE_GAME_STORE/);
  assert.match(app,/function restoreCurrentGame\(/);
  assert.match(app,/newGame\(\{preserveSave:true\}\);restoreCurrentGame\(\)/);
  assert.match(app,/window\.addEventListener\("pagehide",persistCurrentGame\)/);
});
test("AI engine errors do not give player an extra turn",()=>{
  const handler=app.slice(app.indexOf("function scheduleAI()"),app.indexOf("async function human("));
  assert.doesNotMatch(handler,/catch\(error\)[\s\S]*?game\.turn=game\.humanColor/);
  assert.match(app,/retryAI"\)\.hidden=!\(game\.aiError/);
});
test("PVP retains a retry loop after failed ticket or websocket reconnection",()=>{
  assert.match(pvp,/function scheduleSocketReconnect\(/);
  assert.match(pvp,/connectSocket\(roomId\)\.catch\(error=>\{/);
  assert.match(pvp,/scheduleSocketReconnect\(\);/);
  assert.match(pvp,/roomState && socket\?\.readyState === WebSocket\.OPEN/);
});
test("Update prompt is opt-in, never an automatic reload",()=>{
  assert.match(offline,/window\.confirm\(/);
});
