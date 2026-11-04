// Hybrid native presentation and touch navigation; core gameplay remains in v4.0.
const $=id=>document.getElementById(id);
const links=[
 ["game","🐾","对弈"],["replay","🧠","复盘"],["puzzle","🎯","挑战"],["pvp","♟","好友"],["account","🐱","我的"]
];
for(const [id,emoji,label] of links){
 const button=$("tab-"+id);
 if(!button)throw Error("Offline navigation target missing: "+id);
 button.replaceChildren();
 const span=document.createElement("span");span.textContent=emoji;span.setAttribute("aria-hidden","true");
 button.append(span,document.createTextNode(label));
 button.setAttribute("aria-label",label);
}
const mark=document.querySelector(".brand-mark");
if(mark){
 const picture=document.createElement("img");
 picture.src="./icons/cat-gomoku.svg";picture.alt="猫猫棋局";
 mark.replaceChildren(picture);
}
const title=document.querySelector(".brand-lockup h1");
if(title)title.innerHTML='猫猫棋局 <sup>联网 · 离线</sup>';
const identity=$("cloudBanner");
if(identity)identity.textContent=navigator.onLine?"联网可用 · 本地 AI 不依赖服务器":"当前离线 · 单机功能正常，联网功能等待恢复";
const cloudStatus=document.querySelector(".cloud-status");
if(cloudStatus){
 const badge=document.createElement("small");badge.id="hybridConnectionStatus";badge.className="hybrid-connection-status";
 cloudStatus.append(badge);
 const update=()=>{badge.textContent=navigator.onLine?"网络已连接":"离线模式";badge.classList.toggle("is-offline",!navigator.onLine);};
 update();window.addEventListener("online",()=>{update();if(identity)identity.textContent="网络已恢复 · 正在同步账号与对局";});
 window.addEventListener("offline",()=>{update();if(identity)identity.textContent="当前离线 · 本地 AI、棋局和复盘仍可用";});
}

function modeButton(text,target){
 const button=document.createElement("button");
 button.type="button";button.textContent=text;
 button.addEventListener("click",()=>$("tab-"+target)?.click());
 return button;
}
const puzzlePanel=$("panel-puzzle");
if(puzzlePanel){
 const bar=document.createElement("div");bar.className="offline-mode-switch";
 bar.append(modeButton("🎯 残局挑战","puzzle"),modeButton("🎲 随机连珠","random"));
 puzzlePanel.querySelector("h2")?.after(bar);
}
const randomPanel=$("panel-random");
if(randomPanel){
 const bar=document.createElement("div");bar.className="offline-mode-switch";
 bar.append(modeButton("🎯 残局挑战","puzzle"),modeButton("🎲 随机连珠","random"));
 randomPanel.querySelector("h2")?.after(bar);
}
const playerPanel=$("panel-leaderboard");
if(playerPanel){const h2=playerPanel.querySelector("h2");if(h2)h2.textContent="在线排行榜";}
const accountPanel=$("panel-account");
if(accountPanel){
 const shortcuts=document.createElement("div");shortcuts.className="hybrid-shortcuts";
 for(const [id,label] of [["leaderboard","🏆 在线排行榜"],["store","🎨 皮肤收藏"]]){
  const button=document.createElement("button");button.type="button";button.textContent=label;
  button.addEventListener("click",()=>$("tab-"+id)?.click());shortcuts.append(button);
 }
 accountPanel.querySelector("h2")?.after(shortcuts);
 const install=document.createElement("section");install.className="offline-install";
 const heading=document.createElement("strong");heading.textContent="🐱 猫猫棋局 · 原生 App";
 const message=document.createElement("p");message.textContent="联网时登录账号、使用 AI 教练和好友 PVP；断网时继续本地 AI、残局与复盘。";
 const installButton=document.createElement("button");installButton.type="button";installButton.textContent="安装到设备";
 install.append(heading,message,installButton);accountPanel.append(install);
 let installPrompt=null;
 window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();installPrompt=event;installButton.disabled=false;});
 installButton.addEventListener("click",async()=>{
  if(installPrompt){const prompt=installPrompt;installPrompt=null;await prompt.prompt();await prompt.userChoice;return;}
  const apple=/iPad|iPhone|iPod/.test(navigator.userAgent);
  message.textContent=apple?"iPhone/iPad：使用 Safari 打开后，点分享 → 添加到主屏幕。":"使用浏览器菜单中的「安装应用」或「添加到主屏幕」。";
 });
 if(globalThis.Capacitor?.isNativePlatform?.()){
  installButton.hidden=true;
  message.textContent="已安装猫猫棋局 App。联网与离线玩法共用同一套游戏界面。";
 }
}
for(const panelId of ["panel-leaderboard","panel-store"]){
 const panel=$(panelId);if(!panel)continue;
 const back=document.createElement("button");back.type="button";back.className="hybrid-back-button";back.textContent="← 返回我的";
 back.addEventListener("click",()=>$("tab-account")?.click());panel.querySelector("h2")?.before(back);
}
const reviewButton=$("review");if(reviewButton)reviewButton.textContent="AI 复盘";
const gameStats=$("panel-game");
if(gameStats){
 const toggle=document.createElement("button");toggle.type="button";toggle.className="offline-stats-button";
 toggle.textContent="展开棋力分析";toggle.setAttribute("aria-expanded","false");
 gameStats.querySelector("h2")?.before(toggle);
 toggle.addEventListener("click",()=>{
  const expanded=gameStats.classList.toggle("offline-stats-expanded");
  toggle.textContent=expanded?"收起棋力分析":"展开棋力分析";
  toggle.setAttribute("aria-expanded",String(expanded));
 });
}
window.addEventListener("gomoku:tab-change",event=>{
 const tab=event.detail?.tab,selected=tab==="random"?"puzzle":tab==="store"||tab==="leaderboard"?"account":tab;
 if(matchMedia("(max-width:720px)").matches&&selected){
  for(const [id] of links)$("tab-"+id)?.classList.toggle("active",id===selected);
 }
});
