import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync,statSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url)),dist=path.join(root,"dist");
const read=name=>readFileSync(path.join(dist,name),"utf8");
test("offline HTML is isolated from cloud and online PVP",()=>{
 const html=read("index.html");
 assert.match(html,/offline-config\.js/);
 assert.match(html,/experience\.js/);
 assert.match(html,/manifest\.webmanifest/);
 assert.doesNotMatch(html,/<script[^>]+src="\.\/pvp-ui\.js"/);
 assert.doesNotMatch(html,/<script[^>]+src="\.\/config\.js"/);
 assert.match(html,/viewport-fit=cover/);
 assert.match(html,/猫猫棋局 · 离线版/);
 const config=read("offline-config.js");
 assert.match(config,/GOMOKU_API_URL\s*=\s*""/);
 assert.match(config,/GOMOKU_SUPABASE_URL\s*=\s*""/);
 assert.match(config,/GOMOKU_PVP_API_URL\s*=\s*""/);
});
test("standalone offline shell includes all local JS, engines and runtime",()=>{
 for(const name of ["src/app.js","src/review.js","src/engine.js","src/special-modes.js","src/ai.worker.js","src/gunuce.worker.js","src/gunuce-runtime.js","models/gunuce.onnx","special-modes-ui.js","src/offline-cache.js","vendor/ort/ort.wasm.min.mjs"]){
  assert(existsSync(path.join(dist,name)),name);
 }
 const sw=read("sw.js");
 const assets=JSON.parse(sw.match(/const ASSETS=(\[[^\n]*\]);/)[1]);
 const preload=JSON.parse(sw.match(/const PRELOAD=(\[[^\n]*\]);/)[1]);
 for(const name of assets.slice(1))assert(existsSync(path.join(dist,name)),name);
 assert(preload.includes("models/gunuce.onnx"));
 assert(preload.includes("vendor/ort/ort-wasm-simd-threaded.wasm"));
 assert.doesNotMatch(read("src/offline-cache.js"),/v4\.0\.8|管理员后台/);
});
test("PWA metadata and raster app icons are complete",()=>{
 const manifest=JSON.parse(read("manifest.webmanifest"));
 assert.equal(manifest.display,"standalone");
 assert.equal(manifest.lang,"zh-CN");
 assert.equal(manifest.icons.length,3);
 for(const size of [192,512,1024]){
  const bytes=readFileSync(path.join(dist,"icons","icon-"+size+".png"));
  assert.equal(bytes.toString("hex",0,8),"89504e470d0a1a0a");
  assert.equal(bytes.readUInt32BE(16),size);
  assert.equal(bytes.readUInt32BE(20),size);
 }
 assert(statSync(path.join(dist,"models/gunuce.onnx")).size>1_000_000);
});
test("native builds use the offline bundle and mobile safe areas",()=>{
 const config=JSON.parse(readFileSync(path.join(root,"capacitor.config.json"),"utf8"));
 assert.equal(config.webDir,"dist");
 assert(config.appId.startsWith("io.github.nkfff."));
 const css=read("offline.css");
 assert.match(css,/@media\(max-width:720px\)/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/min-height:44px/);
});
