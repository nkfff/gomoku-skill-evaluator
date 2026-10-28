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
test("leaderboard displays win rate and ranks by adjusted rate, games and earned points",()=>{
 assert.ok(html.includes('<th>总对局</th><th>胜率</th><th>累计获胜积分</th>'));
 assert.ok(app.includes("p.games_played"));
 assert.ok(app.includes("p.win_rate"));
 assert.ok(worker.includes("AS win_rate"));
 assert.ok(worker.includes("ORDER BY adjusted_win_rate DESC,games_played DESC,earned_points DESC"));
 assert.ok(worker.includes("wins+2.5"));
 assert.ok(worker.includes("AND (wins+losses+draws)>0"));
});
test("admins can adjust their own points but cannot ban or reset themselves",()=>{
 assert.ok(worker.includes("target===user.id&&url.pathname!=="));
 assert.ok(worker.includes("管理员可以调整自己的积分，但不能封禁或重置自己的账号"));
});
