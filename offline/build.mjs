import {cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";

const here=fileURLToPath(new URL(".",import.meta.url));
const source=path.resolve(here,"../v4.0");
const out=path.join(here,"dist");
const version="0.1.0-beta.4";
if(!existsSync(path.join(source,"src/review.js")))throw Error("Expected V4 review implementation is missing; please update the source snapshot.");
rmSync(out,{recursive:true,force:true});
mkdirSync(out,{recursive:true});
for(const item of ["src","models","vendor"]){
 cpSync(path.join(source,item),path.join(out,item),{recursive:true});
}
for(const item of ["special-modes-ui.js","pvp-ui.js","index.html"]){
 copyFileSync(path.join(source,item),path.join(out,item));
}
for(const item of ["offline-config.js","experience.js","offline.css"]){
 copyFileSync(path.join(here,item),path.join(out,item));
}
mkdirSync(path.join(out,"icons"),{recursive:true});
copyFileSync(path.join(here,"icons/cat-gomoku.svg"),path.join(out,"icons/cat-gomoku.svg"));
copyFileSync(path.join(here,"offline-cache.js"),path.join(out,"src/offline-cache.js"));
if(process.env.GOMOKU_ICON_RENDERER==="resvg"){
 execFileSync(process.execPath,[path.join(here,"desktop/generate-icons.mjs")],{stdio:"inherit"});
}else{
 execFileSync(process.platform==="win32"?"python":"python3",[path.join(here,"render-icons.py")],{stdio:"inherit"});
}

let html=readFileSync(path.join(out,"index.html"),"utf8");
function swap(original,replacement){
 if(!html.includes(original))throw Error("Offline HTML upstream marker missing: "+original);
 html=html.replace(original,replacement);
}
swap('<script src="./config.js"></script>','<script src="./offline-config.js"></script>');
swap('<script type="module" src="./pvp-ui.js"></script>','<script type="module" src="./pvp-ui.js"></script>');
swap('<meta name="viewport" content="width=device-width,initial-scale=1">','<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">');
swap('<link rel="stylesheet" href="./src/style.css">','<link rel="stylesheet" href="./src/style.css">\n<link rel="stylesheet" href="./offline.css">');
swap('</head>','<link rel="manifest" href="./manifest.webmanifest">\n<link rel="icon" type="image/svg+xml" href="./icons/cat-gomoku.svg">\n<link rel="apple-touch-icon" href="./icons/icon-192.png">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-status-bar-style" content="default">\n</head>');
swap('</body>','<script type="module" src="./experience.js"></script>\n</body>');
html=html.replace(/<title>[^<]*<\/title>/,'<title>猫猫棋局 · 联网与离线版</title>');
html=html.replace(/<meta name="theme-color" content="[^"]*">/,'<meta name="theme-color" content="#fff7ed">');
html=html.replace(/<meta name="description" content="[^"]*">/,'<meta name="description" content="猫猫棋局：本地 AI、联网账号、好友对战、AI 复盘与离线单机。">');
html=html.replaceAll("V4.0.2","离线版").replace("GOMOKU CLUB · V4.0.8","GOMOKU CLUB · HYBRID");
html=html.replace(/<p class="note board-note">[^<]*<\/p>/,'<p class="note board-note">本地 AI 与 Gunuce 可断网运行；联网后可登录账号、使用在线 AI 复盘、好友 PVP 与云端排行榜。</p>');
html=html.replace(/<p id="puzzleRewardStatus" class="note">[^<]*<\/p>/,'<p id="puzzleRewardStatus" class="note">联网账号由服务器验证并结算奖励；离线游客奖励保存在本机。</p>');
writeFileSync(path.join(out,"index.html"),html);

const manifest={
 name:"猫猫棋局",short_name:"猫猫棋局",lang:"zh-CN",
 id:"./",start_url:"./",scope:"./",display:"standalone",background_color:"#fff7ed",theme_color:"#fff7ed",
 description:"猫猫棋局：本地 AI、联网账号、好友对战、AI 复盘与离线单机",
 icons:[
  {src:"./icons/icon-192.png",sizes:"192x192",type:"image/png",purpose:"any"},
  {src:"./icons/icon-512.png",sizes:"512x512",type:"image/png",purpose:"any maskable"},
  {src:"./icons/cat-gomoku.svg",sizes:"any",type:"image/svg+xml",purpose:"any"}
 ]
};
writeFileSync(path.join(out,"manifest.webmanifest"),JSON.stringify(manifest,null,2)+"\n");

function allFiles(dir,relative=""){
 const result=[];
 for(const dirent of readdirSync(dir,{withFileTypes:true})){
  const name=path.posix.join(relative,dirent.name);
  if(dirent.isDirectory())result.push(...allFiles(path.join(dir,dirent.name),name));
  else if(dirent.isFile())result.push(name);
 }
 return result;
}
const all=allFiles(out).filter(name=>name!=="sw.js");
const required=all.filter(name=>
 !name.startsWith("vendor/ort/")||
 ["vendor/ort/ort.wasm.min.mjs","vendor/ort/ort-wasm-simd-threaded.mjs","vendor/ort/ort-wasm-simd-threaded.wasm"].includes(name)
);
const digest=createHash("sha256");
for(const name of required)digest.update(name+"\n").update(readFileSync(path.join(out,name)));
const cacheVersion=version+"-"+digest.digest("hex").slice(0,12);
const worker=[
 "/* Local-first app shell: cache all game assets; online APIs are called only by explicit cloud features. */",
 "const VERSION="+JSON.stringify(cacheVersion)+";",
 "const ASSETS="+JSON.stringify(["./",...all])+";",
 "const PRELOAD="+JSON.stringify(["./",...required])+";",
 "const BASE=self.registration.scope;",
 "const PREFIX='cat-gomoku-offline-';",
 "const CACHE=PREFIX+VERSION;",
 "const URLS=new Set(ASSETS.map(n=>new URL(n,BASE).href));",
 "async function status(){const cache=await caches.open(CACHE); const ready=(await Promise.all(PRELOAD.map(n=>cache.match(new URL(n,BASE))))).every(Boolean);for(const client of await self.clients.matchAll({includeUncontrolled:true})){if(client.url.startsWith(BASE))client.postMessage({type:'offline-status',ready});}}",
 "self.addEventListener('install',e=>e.waitUntil((async()=>{const cache=await caches.open(CACHE);for(let i=0;i<PRELOAD.length;i+=8){await cache.addAll(PRELOAD.slice(i,i+8).map(n=>new URL(n,BASE).href));}await self.skipWaiting();})()));",
 "self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const n of await caches.keys()){if(n.startsWith(PREFIX)&&n!==CACHE)await caches.delete(n);}await self.clients.claim();await status();for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){if(client.url.startsWith(BASE))client.postMessage({type:'sw-update-ready',version:VERSION});}})()));",
 "self.addEventListener('message',e=>{if(e.data?.type==='offline-status')e.waitUntil(status());});",
 "self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const url=new URL(e.request.url);url.search='';url.hash='';if(!URLS.has(url.href))return;e.respondWith((async()=>{const cache=await caches.open(CACHE),hit=await cache.match(url.href);if(hit)return hit;const response=await fetch(e.request);if(response.ok)await cache.put(url.href,response.clone());return response;})());});"
].join("\n")+"\n";
writeFileSync(path.join(out,"sw.js"),worker);
const totalBytes=required.reduce((n,f)=>n+statSync(path.join(out,f)).size,0);
console.log(JSON.stringify({edition:version,files:all.length,precacheBytes:totalBytes,cacheVersion},null,2));
