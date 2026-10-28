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
