import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");

test("所有非复盘页必须隐藏本局复盘报告，即使 review-sidebar 使用 flex",()=>{
 const css=read("../src/style.css"),html=read("../index.html"),app=read("../src/app.js");
 assert.match(css,/#panel-replay\[hidden\]/);
 assert.match(css,/\.side-panel\s*>\s*section\[hidden\]/);
 assert.match(html,/<section id="panel-replay"[^>]*hidden/);
 assert.match(app,/panel\.hidden=name!==tab/);
});
test("在线棋局教练取代关键词跳转，使用真实棋谱并流式输出",()=>{
 const html=read("../index.html"),app=read("../src/app.js");
 assert.match(html,/id="reviewOnlineStatus"/);
 assert.match(html,/id="reviewOnlineResult"/);
 assert.match(app,/\/api\/review\/coach/);
 assert.match(app,/event==="delta"/);
 assert.match(app,/response\.body\.getReader\(\)/);
 assert.match(app,/game\.moves\.slice\(0,replayStep\)\.map/);
 assert.match(app,/playerColor:game\.humanColor/);
 assert.doesNotMatch(app,/google\.com\/search/);
 assert.match(app,/controller\.abort\(\),60000/);
});
test("复盘双栏桌面布局上下对齐，窄屏恢复自然高度",()=>{
 const css=read("../src/style.css");
 assert.ok(css.includes("align-items:stretch"));
 assert.ok(css.includes(".layout.review-mode>.board-panel{display:flex;flex-direction:column}"));
 assert.ok(css.includes("@media(max-width:950px){\n .layout.review-mode{align-items:start}"));
});
