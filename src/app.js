import {SIZE,CELLS,LEVELS,coord,inside,spot,winLine,chooseAI,advice,replay} from "./engine.js";
const $=id=>document.getElementById(id);
const skins=[
{id:"classic",name:"经典榉木",cost:0,bg:"#dcb77b",grid:"#815830",black:"#18191e",white:"#fffdf4"},
{id:"jade",name:"翡翠棋盘",cost:60,bg:"#a8c8b2",grid:"#42725b",black:"#175246",white:"#eefff5"},
{id:"night",name:"暗夜星河",cost:150,bg:"#24283b",grid:"#65729b",black:"#0d1024",white:"#b9c9ff"},
{id:"cherry",name:"樱花庭院",cost:260,bg:"#f0c8cd",grid:"#a96a76",black:"#73334f",white:"#fff1f6"},
{id:"gold",name:"曜金棋局",cost:500,bg:"#3c3131",grid:"#ac884a",black:"#171414",white:"#efd19a"}
];
const STORE="gomoku-v2-local-player";
const freshProfile=()=>({id:crypto.randomUUID(),name:"匿名棋手",points:0,owned:["classic"],skin:"classic",wins:0,losses:0,draws:0,claimed:[]});
function loadProfile(){try{const s=JSON.parse(localStorage.getItem(STORE));if(s&&typeof s.id==="string"&&Array.isArray(s.owned))return {...freshProfile(),...s};}catch{}return freshProfile();}
let profile=loadProfile(),game,task=null,turnToken=0,activeTab="game",endedAt=0,replayStep=0,lastResult=null,cloudEnabled=false;
function save(){localStorage.setItem(STORE,JSON.stringify(profile));}
function newGame(){
 clearTimeout(task);turnToken++;
 const now=performance.now();
 game={b:Array(CELLS).fill(0),moves:[],events:[],level:$("difficulty").value,turn:1,started:now,turnStart:now,ended:0,result:0,undo:0};
 endedAt=0;replayStep=0;lastResult=null;
 $("review").disabled=true;$("undo").disabled=true;
 $("recommend").textContent="选一手落子后，这里将显示推荐与棋形解释。";
 activate("game");render();
}
function drop(i,p,elapsed,analysis=null){
 game.b[i]=p;
 const record={i,p,coord:coord(i),seconds:+elapsed.toFixed(2),at:new Date().toISOString(),analysis};
 game.moves.push(record);game.events.push({type:"move",...record});
 if(winLine(game.b,i,p).length){finish(p);return;}
 if(game.moves.length===225)finish(3);
}
function finish(result){
 game.result=result;game.turn=0;game.ended=performance.now();endedAt=game.ended;clearTimeout(task);task=null;
 game.events.push({type:"end",result,at:new Date().toISOString()});
 $("undo").disabled=true;$("review").disabled=false;
 if(result===1){profile.wins++;profile.points+=LEVELS[game.level].reward;}
 else if(result===2)profile.losses++;else profile.draws++;
 save();
 render();
}
function human(i){
 if(game.turn!==1||game.b[i]||game.result)return;
 const before=game.b.slice();
 const evaluation=advice(before,1,i);
 drop(i,1,(performance.now()-game.turnStart)/1000,evaluation);
 if(!game.result){
  game.turn=2;const current=++turnToken,t0=performance.now();
  task=setTimeout(()=>{
   if(current!==turnToken||game.turn!==2)return;
   const choice=chooseAI(game.b,game.level);
   const prior=game.b.slice();drop(choice.index,2,(performance.now()-t0)/1000,{...advice(prior,2,choice.index),reason:choice.reason,nodes:choice.nodes});
   if(!game.result){game.turn=1;game.turnStart=performance.now();}
   render();
  },120);
 }
 render();
}
function undo(){
 if(!game.moves.length||game.result)return;
 clearTimeout(task);turnToken++;
 const count=game.moves.at(-1).p===2?2:1;
 const removed=game.moves.splice(-count);
 for(const m of removed)game.b[m.i]=0;
 game.undo++;game.events.push({type:"undo",removed:removed.map(m=>m.coord),at:new Date().toISOString()});
 game.turn=1;game.turnStart=performance.now();render();
}
function activate(tab){
 activeTab=tab;
 for(const name of ["game","replay","store","leaderboard"]){
  $("tab-"+name).classList.toggle("active",name===tab);
  $("panel-"+name).hidden=name!==tab;
 }
 render();
}
function draw(b,last=-1){
 const canvas=$("board"),ctx=canvas.getContext("2d");
 const skin=skins.find(x=>x.id===profile.skin)||skins[0];
 const cell=40,offset=32;
 ctx.clearRect(0,0,640,640);ctx.fillStyle=skin.bg;ctx.fillRect(0,0,640,640);
 ctx.strokeStyle=skin.grid;ctx.lineWidth=1.3;
 for(let k=0;k<15;k++){const x=offset+cell*k;ctx.beginPath();ctx.moveTo(offset,x);ctx.lineTo(592,x);ctx.moveTo(x,offset);ctx.lineTo(x,592);ctx.stroke();}
 for(const r of [3,7,11])for(const c of [3,7,11]){ctx.fillStyle=skin.grid;ctx.beginPath();ctx.arc(offset+c*cell,offset+r*cell,3.5,0,7);ctx.fill();}
 for(let i=0;i<CELLS;i++)if(b[i]){
  const x=offset+i%15*cell,y=offset+Math.floor(i/15)*cell;
  ctx.beginPath();ctx.arc(x,y,16.5,0,7);ctx.fillStyle=b[i]===1?skin.black:skin.white;ctx.shadowColor="#0005";ctx.shadowBlur=4;ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle=skin.grid;ctx.lineWidth=.6;ctx.stroke();
  if(i===last){ctx.beginPath();ctx.arc(x,y,4.5,0,7);ctx.fillStyle="#f34c42";ctx.fill();}
 }
}
function render(){
 if(!game)return;
 $("identity").textContent=profile.name+" · "+profile.id.slice(0,8);
 $("points").textContent=profile.points;
 $("scoreboard").textContent="胜 "+profile.wins+" / 负 "+profile.losses+" / 平 "+profile.draws;
 $("undoCount").textContent=game.undo;
 $("status").textContent=game.result?({1:"胜利！获得 "+LEVELS[game.level].reward+" 积分",2:"电脑获胜",3:"平局"}[game.result]):game.turn===1?"轮到你（黑棋）":"电脑思考中";
 $("undo").disabled=!!game.result||!game.moves.length;
 $("review").disabled=!game.moves.length;
 const display=activeTab==="replay"?replay(game.moves)[replayStep]:game.b;
 draw(display,activeTab==="replay"?(replayStep?game.moves[replayStep-1].i:-1):game.moves.at(-1)?.i??-1);
 $("history").innerHTML=game.moves.map((m,j)=>"<button class='move "+(activeTab==="replay"&&replayStep===j+1?"selected":"")+"' data-step='"+(j+1)+"'>"+(j+1)+". "+(m.p===1?"●":"○")+" "+m.coord+" · "+m.seconds.toFixed(1)+"s</button>").join("");
 $("history").querySelectorAll("[data-step]").forEach(x=>x.onclick=()=>{replayStep=Number(x.dataset.step);activate("replay");});
 $("stepLabel").textContent=replayStep+" / "+game.moves.length;
 const m=game.moves[replayStep-1];
 $("analysis").textContent=!m?"选择一手查看攻防提示。":("第 "+replayStep+" 手 "+(m.p===1?"玩家":"电脑")+" "+m.coord+"： "+(m.analysis?.category||"未分析")+"。推荐 "+(m.analysis?.alternatives||[]).map(coord).join("、")+"。推荐是启发式结果，并非证明的最优着。");
 $("report").textContent=game.result?("本局结束。共 "+game.moves.length+" 手，悔棋 "+game.undo+" 次。终局计时已冻结，悔棋锁定。"):("当前已下 "+game.moves.length+" 手。复盘中也可在对局结束后逐手查看。");
 renderShop();
}
function renderShop(){
 $("skinShop").innerHTML=skins.map(s=>{
  const owned=profile.owned.includes(s.id),selected=profile.skin===s.id;
  return "<article class='skin'><span class='swatch' style='background:"+s.bg+";border-color:"+s.grid+"'></span><div><b>"+s.name+"</b><small>"+(s.cost?"兑换 "+s.cost+" 积分":"免费")+"</small></div><button data-skin='"+s.id+"' "+(selected?"disabled":"")+">"+(selected?"使用中":owned?"使用":profile.points>=s.cost?"兑换":"积分不足")+"</button></article>";
 }).join("");
 $("skinShop").querySelectorAll("[data-skin]").forEach(btn=>btn.onclick=()=>{
  const s=skins.find(v=>v.id===btn.dataset.skin);
  if(!s)return;
  if(!profile.owned.includes(s.id)){
   if(profile.points<s.cost)return;
   profile.points-=s.cost;profile.owned.push(s.id);
  }
  profile.skin=s.id;save();render();
 });
}
function formatTime(){if(!game)return;const now=game.ended||performance.now(),total=Math.max(0,Math.floor((now-game.started)/1000));$("totalTime").textContent=String(Math.floor(total/60)).padStart(2,"0")+":"+String(total%60).padStart(2,"0");$("thinkTime").textContent=game.result?"已停止":game.turn===1?((performance.now()-game.turnStart)/1000).toFixed(1)+"s":"AI 行棋";}
function download(){const payload={version:2,identity:profile.id,level:game.level,moves:game.moves,events:game.events,undoCount:game.undo,result:game.result};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="gomoku-v2-game.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
function localRank(){
 $("leaderboardMode").textContent="本地模式：仅显示当前浏览器玩家的统计。多人共享排行榜须部署并配置独立服务端。";
 $("rankRows").innerHTML="<tr><td>1</td><td>"+escapeText(profile.name)+"</td><td>"+profile.wins+"</td><td>"+profile.points+"</td></tr>";
}
function escapeText(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function setName(){const name=$("nickname").value.trim().slice(0,20);if(!name)return;profile.name=name;save();render();localRank();}
for(const name of ["game","replay","store","leaderboard"])$("tab-"+name).onclick=()=>activate(name);
$("board").addEventListener("click",e=>{
 if(activeTab==="replay"||activeTab==="store"||activeTab==="leaderboard")return;
 const rect=$("board").getBoundingClientRect(),x=(e.clientX-rect.left)*640/rect.width,y=(e.clientY-rect.top)*640/rect.height;
 const c=Math.round((x-32)/40),r=Math.round((y-32)/40);
 if(inside(r,c)&&Math.hypot(x-(32+c*40),y-(32+r*40))<19)human(spot(r,c));
});
$("newGame").onclick=newGame;
$("undo").onclick=undo;
$("review").onclick=()=>{replayStep=game.moves.length;activate("replay");};
$("prev").onclick=()=>{replayStep=Math.max(0,replayStep-1);render();};
$("next").onclick=()=>{replayStep=Math.min(game.moves.length,replayStep+1);render();};
$("start").onclick=()=>{replayStep=0;render();};
$("end").onclick=()=>{replayStep=game.moves.length;render();};
$("export").onclick=download;
$("setName").onclick=setName;
$("difficulty").onchange=()=>{if(game.moves.length&&!game.result){$("difficulty").value=game.level;alert("请先结束或重新开始本局以更改难度。");}};
newGame();localRank();setInterval(formatTime,150);
