// Offline-only presentation and touch navigation; core gameplay remains in v4.0.
const $=id=>document.getElementById(id);
const links=[
 ["game","🐾","对弈"],["puzzle","🎯","挑战"],["store","🎨","装扮"],["leaderboard","🏡","我的"]
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
if(title)title.innerHTML='猫猫棋局 <sup>离线版</sup>';
const identity=$("cloudBanner");
if(identity)identity.textContent="离线单机 · 不依赖账号或服务器";

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
if(playerPanel){
 const h2=playerPanel.querySelector("h2");
 if(h2)h2.textContent="我的本地战绩";
 const install=document.createElement("section");install.className="offline-install";
 const heading=document.createElement("strong");heading.textContent="🐱 把猫猫棋局装进口袋";
 const message=document.createElement("p");message.textContent="安装后可离线使用。单机积分与在线账号分开保存。";
 const button=document.createElement("button");button.type="button";button.textContent="安装到设备";
 install.append(heading,message,button);playerPanel.append(install);
 let installPrompt=null;
 window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();installPrompt=event;button.disabled=false;});
 button.addEventListener("click",async()=>{
  if(globalThis.Capacitor?.isNativePlatform?.())return;
  if(installPrompt){
   const prompt=installPrompt;installPrompt=null;
   await prompt.prompt();await prompt.userChoice;return;
  }
  const apple=/iPad|iPhone|iPod/.test(navigator.userAgent);
  message.textContent=apple?"iPhone/iPad：使用 Safari 打开离线版，点分享 → 添加到主屏幕。":"使用浏览器菜单中的「安装应用」或「添加到主屏幕」。";
 });
 if(globalThis.Capacitor?.isNativePlatform?.()){button.hidden=true;message.textContent="已安装独立单机版，所有游戏资源随 App 内置。";}
}
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
 const tab=event.detail?.tab,selected=tab==="random"?"puzzle":tab==="replay"?"game":tab;
 if(matchMedia("(max-width:720px)").matches&&selected){
  for(const [id] of links)$("tab-"+id)?.classList.toggle("active",id===selected);
 }
});
