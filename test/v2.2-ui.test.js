import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const app=readFileSync(new URL("../src/app.js",import.meta.url),"utf8");
const account=readFileSync(new URL("../src/account.js",import.meta.url),"utf8");
const worker=readFileSync(new URL("../worker/index.js",import.meta.url),"utf8");
const foundIds=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
test("all active user-interface IDs exist in V2.2 HTML",()=>{
 const ids=[...app.matchAll(/\$\(["']([^"']+)["']\)/g),...account.matchAll(/\$\(["']([^"']+)["']\)/g)].map(m=>m[1]);
 const missing=[...new Set(ids)].filter(id=>!foundIds.has(id));
 assert.deepEqual(missing,[]);
});
test("move recommendations only appear after the explicit hint action",()=>{
 assert.match(html,/id="hintPanel"\s+hidden/);
 assert.match(app,/hintVisible=false/);
 assert.match(app,/function hintMove\(\)/);
 assert.match(app,/\$\("hint"\)\.onclick=hintMove/);
 assert.match(app,/activeTab==="game"&&hintVisible&&game\.turn===1/);
 assert.match(app,/hintRequest\+\+;.*hintPanel/);
});
test("V2.2 economy has server-side three-free-undo rule and auth checks",()=>{
 assert.match(worker,/game\.undo_count>=3/);
 assert.match(worker,/cost=paid\?10:0/);
 assert.match(worker,/await authenticate\(request,env\)/);
 assert.match(worker,/adminOrThrow\(env,user\)/);
});
test("leaderboard ranks by composite points while showing raw win rate separately",()=>{
 assert.ok(html.includes('<th>总对局</th><th>胜率</th><th>综合积分</th>'));
 assert.ok(app.includes("p.games_played"));
 assert.ok(app.includes("p.win_rate"));
 assert.ok(app.includes("p.rank_points"));
 assert.ok(worker.includes("AS win_rate"));
 assert.ok(worker.includes("AS rank_points"));
 assert.ok(worker.includes("ORDER BY rank_points DESC,earned_points DESC,wins DESC,games_played DESC"));
 assert.ok(worker.includes("MAX(0,ROUND(earned_points+(adjusted_win_rate-50)*MIN(games_played,20)/10.0)) AS rank_points"));
 assert.ok(worker.includes("const award={easy:10,normal:30,hard:80}"));
 assert.ok(worker.includes("AND (wins+losses+draws)>0"));
});
test("admins can adjust their own points but cannot ban or reset themselves",()=>{
 assert.ok(worker.includes("target===user.id&&url.pathname!=="));
 assert.ok(worker.includes("管理员可以调整自己的积分，但不能封禁或重置自己的账号"));
});
test("timer starts only after the explicit start action and pre-start moves are blocked",()=>{
 assert.ok(html.includes('id="startGame" class="primary">开始下棋'));
 assert.ok(app.includes("startedGame:false"));
 assert.ok(app.includes("game.started=now;game.turnStart=now;game.startedGame=true;"));
 assert.ok(app.includes('$("startGame").onclick=startGame;'));
 assert.ok(app.includes('if(!game.startedGame){$("totalTime").textContent="00:00";$("thinkTime").textContent="未开始";return;}'));
 assert.ok(app.includes("if(!game.startedGame||game.turn!==1||game.b[i]||game.result||remoteBusy)return;"));
});
test("email confirmation shows a visible message outside the account tab",()=>{
 assert.ok(html.includes('id="authFeedback" class="auth-feedback" hidden role="status"'));
 assert.ok(account.includes("setGlobalFeedback"));
 assert.ok(account.includes("邮箱验证成功！账号已激活并自动登录"));
 assert.ok(account.includes("hasAuthCallback"));
});

test("V2.3 AI matches are local-first and only submit the completed game",()=>{
 assert.match(app,/function startGame\(\)/);
 const start=app.slice(app.indexOf("function startGame"),app.indexOf("function drop"));
 assert.doesNotMatch(start,/api\("start"/);
 assert.match(app,/api\("submit"/);
 assert.match(worker,/url\.pathname==="\/api\/submit"/);
 assert.match(worker,/validateSubmittedTimeline/);
});
test("V2.3 provides a cat-themed board, cat-head pieces and optional move sound",()=>{
 assert.ok(app.includes('id:"catcafe"'));assert.ok(app.includes('id:"cat"'));
 assert.match(app,/function drawCatPiece/);assert.match(app,/function playMoveSound/);
 assert.ok(html.includes('id="soundToggle"'));assert.ok(html.includes('id="retrySync"'));
});
