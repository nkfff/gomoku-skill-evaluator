import {SIZE,CELLS,LEVELS,coord,inside,spot,winLine,chooseAI,advice,replay,rankedMoves} from "./engine.js";
import {initAccount,bearer,loggedIn,cloudConfigured} from "./account.js";
import {summarizeQuality} from "./assessment.js";
const $=id=>document.getElementById(id);
const skins=[
{id:"classic",name:"经典榉木",cost:0,bg:"#dcb77b",grid:"#815830",black:"#18191e",white:"#fffdf4"},
{id:"jade",name:"翡翠棋盘",cost:60,bg:"#a8c8b2",grid:"#42725b",black:"#175246",white:"#eefff5"},
{id:"night",name:"暗夜星河",cost:150,bg:"#24283b",grid:"#65729b",black:"#0d1024",white:"#b9c9ff"},
{id:"cherry",name:"樱花庭院",cost:260,bg:"#f0c8cd",grid:"#a96a76",black:"#73334f",white:"#fff1f6"},
{id:"catcafe",name:"猫咪咖啡馆",cost:480,bg:"#fff1f6",grid:"#c7789a",black:"#29243a",white:"#fff9fc",cat:true},
{id:"gold",name:"曜金棋局",cost:500,bg:"#3c3131",grid:"#ac884a",black:"#171414",white:"#efd19a"}
];
const pieceSkins=[
 {id:"classic",name:"经典玉石",cost:0,black:"#18191e",white:"#fffdf4",ring:"#74706d",gloss:false},
 {id:"crystal",name:"水晶冰魄",cost:45,black:"#2367b3",white:"#d5faff",ring:"#86d3ff",gloss:true},
 {id:"ink",name:"水墨丹青",cost:85,black:"#14262c",white:"#f5e9d8",ring:"#c28d5e",gloss:false},
 {id:"neon",name:"霓虹宇宙",cost:140,black:"#bb35fe",white:"#42f7ed",ring:"#f0a4ff",gloss:true},
 {id:"pearl",name:"黑曜珍珠",cost:220,black:"#2c182a",white:"#ffdcf0",ring:"#d7a0b9",gloss:true},
 {id:"cat",name:"猫猫软糖",cost:680,black:"#30273f",white:"#fff8fc",ring:"#ee8db2",gloss:true,cat:true}
];
const STORE="gomoku-v2-local-player";
const PENDING_STORE="gomoku-v2-pending-submissions";
const SOUND_STORE="gomoku-v2-sound";
let soundEnabled=localStorage.getItem(SOUND_STORE)!=="off";
let audioContext=null;
const API_URL=(window.GOMOKU_API_URL||"").replace(/\/$/,"");
const cloudMode=()=>cloudConfigured()&&loggedIn();
let remoteGame=null,remoteBusy=false;
async function api(path,payload){const token=await bearer();if(!token)throw Error("请先登录以使用云端功能");
 const r=await fetch(API_URL+"/api/"+path,{method:payload?"POST":"GET",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:payload?JSON.stringify(payload):undefined});
 const v=await r.json();if(!r.ok)throw Error(v.error||"Cloud API unavailable");return v;
}
function applyRemoteProfile(p){if(!p)return;
 profile.id=p.id;profile.points=p.points;profile.earnedPoints=p.earned_points;profile.wins=p.wins;profile.losses=p.losses;profile.draws=p.draws;
 profile.owned=p.inventory;profile.boardSkin=p.selected_board||"classic";profile.pieceSkin=p.selected_piece||"classic";profile.name=p.name; /* Cloud data is not written over the guest profile. */
}
const freshProfile=()=>({id:crypto.randomUUID(),name:"匿名棋手",points:0,earnedPoints:0,owned:["classic","board:classic","piece:classic"],skin:"classic",boardSkin:"classic",pieceSkin:"classic",wins:0,losses:0,draws:0,claimed:[]});
function loadProfile(){try{const s=JSON.parse(localStorage.getItem(STORE));if(s&&typeof s.id==="string"&&Array.isArray(s.owned))return {...freshProfile(),...s,boardSkin:s.boardSkin||s.skin||"classic",pieceSkin:s.pieceSkin||"classic"};}catch{}return freshProfile();}
let profile=loadProfile(),game,task=null,turnToken=0,activeTab="game",endedAt=0,replayStep=0,lastResult=null,cloudEnabled=false;
let hints=[],hintVisible=false,hintRequest=0,previewBoard="classic",previewPiece="classic";
const analysisWorker = typeof Worker !== "undefined" ? new Worker(new URL("./analysis.worker.js", import.meta.url), {type:"module"}) : null;
if (analysisWorker) {
 analysisWorker.onmessage = ({data})=>{
  if(!game || data.gameId!==game.id)return;
  const move=game.moves.find(m=>m.id===data.moveId);
  if(!move)return;
  if(data.quality)move.quality=data.quality;
  else move.analysisError=data.error;
  render();
 };
 analysisWorker.onerror = ()=>{ $("qualityNotice").textContent="后台分析失败，请刷新重试；棋局不受影响。"; };
}
function requestAnalysis(before,move){
 if(analysisWorker)analysisWorker.postMessage({gameId:game.id,moveId:move.id,board:before,player:move.p,played:move.i});
 else move.analysisError="当前浏览器不支持后台分析";
}
function save(){localStorage.setItem(STORE,JSON.stringify(profile));}
function playMoveSound(p){
 if(!soundEnabled)return;
 try{
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)return;
  audioContext=audioContext||new AudioContextClass();
  if(audioContext.state==="suspended")audioContext.resume();
  const now=audioContext.currentTime,osc=audioContext.createOscillator(),gain=audioContext.createGain();
  osc.type="sine";osc.frequency.setValueAtTime(p===1?560:760,now);
  osc.frequency.exponentialRampToValueAtTime(p===1?350:510,now+0.055);
  gain.gain.setValueAtTime(0.0001,now);gain.gain.exponentialRampToValueAtTime(0.065,now+0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001,now+0.095);
  osc.connect(gain);gain.connect(audioContext.destination);osc.start(now);osc.stop(now+0.1);
 }catch{}
}
function updateSoundToggle(){
 const button=$("soundToggle");
 if(button)button.textContent="落子音效："+(soundEnabled?"开":"关");
}
function readPendingSubmissions(){
 try{
  const queue=JSON.parse(localStorage.getItem(PENDING_STORE)||"[]");
  return Array.isArray(queue)?queue.filter(x=>x&&x.playerId&&x.payload&&x.payload.gameId):[];
 }catch{return [];}
}
function submissionPayload(g){
 return {gameId:g.id,level:g.level,result:g.result,undoCount:g.undo,
  events:g.events.map(event=>{
   if(event.type==="move")return {type:"move",i:event.i,p:event.p};
   if(event.type==="undo")return {type:"undo",removed:event.removed,paid:event.paid,cost:event.cost};
   if(event.type==="end")return {type:"end",result:event.result};
   return null;
  }).filter(Boolean)};
}
async function syncPendingSubmissions(){
 if(!cloudMode())return;
 let queue=readPendingSubmissions();
 for(const entry of [...queue]){
  if(entry.playerId!==profile.id)continue;
  try{
   const result=await api("submit",entry.payload);
   if(result.profile)applyRemoteProfile(result.profile);
   queue=queue.filter(item=>item.payload.gameId!==entry.payload.gameId);
   localStorage.setItem(PENDING_STORE,JSON.stringify(queue));
   if(game&&game.id===entry.payload.gameId){game.syncState="synced";render();}
   $("cloudBanner").textContent="云端成绩已验证并同步";
  }catch(e){
   if(game&&game.id===entry.payload.gameId){game.syncState="failed";render();}
   $("cloudBanner").textContent="成绩已暂存本地，上传失败："+e.message;
   $("retrySync").hidden=false;return;
  }
 }
 $("retrySync").hidden=!queue.some(entry=>entry.playerId===profile.id);
 await localRank();render();
}
async function submitFinishedGame(g){
 const payload=submissionPayload(g),queue=readPendingSubmissions();
 if(!queue.some(entry=>entry.payload.gameId===payload.gameId)){
  queue.push({playerId:g.playerId,payload});
  localStorage.setItem(PENDING_STORE,JSON.stringify(queue));
 }
 $("retrySync").hidden=false;
 await syncPendingSubmissions();
}
async function newGame(){
 clearTimeout(task);task=null;turnToken++;
 game={id:crypto.randomUUID(),b:Array(CELLS).fill(0),moves:[],events:[],level:$("difficulty").value,turn:1,started:0,turnStart:0,ended:0,result:0,undo:0,startedGame:false,cloudSession:false,playerId:null,syncState:"idle"};
 hints=[];hintVisible=false;hintRequest++;$("hintPanel").hidden=true;
 endedAt=0;replayStep=0;lastResult=null;remoteGame=null;remoteBusy=false;
 $("startGame").disabled=false;$("startGame").textContent="开始下棋";
 $("review").disabled=true;$("undo").disabled=true;$("hint").disabled=true;
 $("recommend").textContent="选一手落子后，这里将显示推荐与棋形解释。";
 activate("game");render();formatTime();
}
function startGame(){
 if(!game||game.startedGame||game.result)return;
 const now=performance.now();
 game.cloudSession=cloudMode();game.playerId=game.cloudSession?profile.id:null;game.syncState="idle";
 game.started=now;game.turnStart=now;game.startedGame=true;
 remoteGame=null;remoteBusy=false;
 $("cloudBanner").textContent=game.cloudSession?"本地即时对局 · 终局后验证并同步成绩":"游客模式 · 对局在本地运行";
 render();formatTime();
}
function drop(i,p,elapsed,analysis=null){
 const before=game.b.slice();
 hints=[];hintVisible=false;hintRequest++;$("hintPanel").hidden=true;
 game.b[i]=p;playMoveSound(p);
 const record={id:crypto.randomUUID(),i,p,coord:coord(i),seconds:+elapsed.toFixed(2),at:new Date().toISOString(),analysis,quality:null};
 game.moves.push(record);game.events.push({type:"move",id:record.id,i,p,coord:record.coord,seconds:record.seconds,at:record.at,analysis});
 requestAnalysis(before,record);
 if(winLine(game.b,i,p).length){finish(p);return;}
 if(game.moves.length===225)finish(3);
}
function finish(result){
 game.result=result;game.turn=0;game.ended=performance.now();endedAt=game.ended;clearTimeout(task);task=null;
 game.events.push({type:"end",result,at:new Date().toISOString()});
 $("undo").disabled=true;$("review").disabled=false;
 if(!game.cloudSession){
  if(result===1){profile.wins++;profile.points+=LEVELS[game.level].reward;profile.earnedPoints+=LEVELS[game.level].reward;}
  else if(result===2)profile.losses++;else profile.draws++;
  save();
 }else{
  game.syncState="pending";
  $("cloudBanner").textContent="对局结束 · 正在验证棋谱并结算成绩";
  const finishedGame=game;
  submitFinishedGame(finishedGame).catch(e=>{
   if(game&&game.id===finishedGame.id)game.syncState="failed";
   $("cloudBanner").textContent="成绩已暂存本地，稍后可重试："+e.message;
   $("retrySync").hidden=false;render();
  });
 }
 render();localRank();
}
async function human(i){
 if(!game.startedGame||game.turn!==1||game.b[i]||game.result||remoteBusy)return;
 const before=game.b.slice();
 const evaluation=advice(before,1,i);
 if(remoteGame){
  if(remoteBusy)return;remoteBusy=true;game.turn=2;render();
  try{
   const started=performance.now(),turnSeconds=(started-game.turnStart)/1000;
   const result=await api("move",{gameId:remoteGame.gameId,revision:remoteGame.revision,index:i});
   game.turn=1;drop(i,1,turnSeconds,evaluation);
   if(result.ai&&result.moves.length>game.moves.length){
    const prior=game.b.slice();drop(result.ai.index,2,(performance.now()-started)/1000,
     {...advice(prior,2,result.ai.index),reason:result.ai.reason});
   }
   remoteGame.revision=result.revision;
   if(result.profile)applyRemoteProfile(result.profile);
   if(!game.result){game.turn=1;game.turnStart=performance.now();}
  }catch(e){game.turn=1;game.turnStart=performance.now();alert("云端落子未成功："+e.message);}
  remoteBusy=false;render();return;
 }
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
async function undo(){
 if(!game.startedGame||!game.moves.length||game.result||game.turn!==1||remoteBusy)return;
 const paid=game.undo>=3;
 const spendable=profile.points-(game.cloudSession?Math.max(0,game.undo-3)*10:0);
 if(paid&&spendable<10){alert("免费悔棋已用尽；再悔棋需要 10 积分。当前可用积分不足。");return;}
 if(paid&&!confirm("免费悔棋已用完，本次扣除 10 积分，确定吗？"))return;
 clearTimeout(task);turnToken++;hints=[];hintVisible=false;hintRequest++;$("hintPanel").hidden=true;
 if(remoteGame){
  remoteBusy=true;render();
  try{
   const result=await api("undo",{gameId:remoteGame.gameId,revision:remoteGame.revision});
   const removed=game.moves.splice(result.moves.length);
   for(const m of removed)game.b[m.i]=0;
   remoteGame.revision=result.revision;game.undo=result.undoCount;
   applyRemoteProfile(result.profile);
   game.events.push({type:"undo",paid:result.paid,cost:result.cost,removed:removed.map(m=>m.coord),at:new Date().toISOString()});
  }catch(e){alert("悔棋失败："+e.message);}
  remoteBusy=false;
 }else{
  const count=game.moves.at(-1).p===2?2:1;
  const removed=game.moves.splice(-count);
  for(const m of removed)game.b[m.i]=0;
  game.undo++;
  if(paid&&!game.cloudSession){profile.points-=10;save();}
  game.events.push({type:"undo",paid,cost:paid?10:0,removed:removed.map(m=>m.coord),at:new Date().toISOString()});
 }
 game.turn=1;game.turnStart=performance.now();render();
}
async function hintMove(){
 if(!game||!game.startedGame||game.turn!==1||game.result||remoteBusy||activeTab!=="game")return;
 const requestId=++hintRequest,gameId=game.id,moveCount=game.moves.length;
 $("hint").disabled=true;
 try{
  let suggestions;
  if(remoteGame){
   const result=await api("hint",{gameId:remoteGame.gameId,revision:remoteGame.revision});
   suggestions=result.suggestions.map(x=>x.index);
  }else suggestions=rankedMoves(game.b,1,3).slice(0,3);
  // Ignore late API replies after a move, reset, undo or tab switch.
  if(requestId!==hintRequest||game.id!==gameId||game.moves.length!==moveCount||game.turn!==1||game.result||activeTab!=="game")return;
  hints=suggestions.filter(i=>!game.b[i]);
  hintVisible=hints.length>0;
  $("hintPanel").hidden=!hintVisible;
  if(hintVisible)$("hintPanel").textContent="战术参谋给你圈出 "+hints.map((i,n)=>(n+1)+". "+coord(i)).join("，")+
   "。标号表示候选优先级；不是经过校准的真实获胜概率。落下一手会自动清除提示。";
  render();
 }catch(e){if(requestId===hintRequest)alert("获取提示失败："+e.message);}
 finally{render();}
}
function activate(tab){
 if(tab!=="game"&&activeTab==="game"){
  hintRequest++;hintVisible=false;hints=[];$("hintPanel").hidden=true;
 }
 activeTab=tab;
 for(const name of ["game","replay","store","leaderboard","account"]){
  $("tab-"+name).classList.toggle("active",name===tab);
  $("panel-"+name).hidden=name!==tab;
 }
 render();
}
function drawPaw(ctx,x,y,scale=1,color="#d78eac"){
 ctx.save();ctx.globalAlpha=0.22;ctx.fillStyle=color;
 ctx.beginPath();ctx.ellipse(x,y+4*scale,5*scale,4*scale,0,0,Math.PI*2);ctx.fill();
 for(const [dx,dy] of [[-5,-3],[-2,-7],[2,-7],[5,-3]]){ctx.beginPath();ctx.arc(x+dx*scale,y+dy*scale,2.3*scale,0,Math.PI*2);ctx.fill();}
 ctx.restore();
}
function drawCatPiece(ctx,x,y,p,piece,isLast=false){
 ctx.save();ctx.translate(x,y);
 const fill=p===1?piece.black:piece.white,outline=p===1?"#f7c0d7":piece.ring;
 ctx.beginPath();ctx.moveTo(-10,-7);ctx.lineTo(-13,-15);ctx.quadraticCurveTo(-14,-18,-10,-16);
 ctx.lineTo(-4,-11);ctx.quadraticCurveTo(0,-13,4,-11);ctx.lineTo(10,-16);ctx.quadraticCurveTo(14,-18,13,-14);
 ctx.lineTo(10,-6);ctx.quadraticCurveTo(16,0,11,9);ctx.quadraticCurveTo(6,15,0,15);
 ctx.quadraticCurveTo(-6,15,-11,9);ctx.quadraticCurveTo(-16,0,-10,-7);ctx.closePath();
 ctx.fillStyle=fill;ctx.shadowColor="#4c304522";ctx.shadowBlur=3;ctx.fill();ctx.shadowBlur=0;
 ctx.strokeStyle=outline;ctx.lineWidth=1.5;ctx.stroke();
 ctx.beginPath();ctx.moveTo(-9,-13);ctx.lineTo(-7,-8);ctx.lineTo(-5,-11);ctx.closePath();
 ctx.moveTo(9,-13);ctx.lineTo(7,-8);ctx.lineTo(5,-11);ctx.closePath();ctx.fillStyle=p===1?"#e98ab3":"#f0b1ca";ctx.fill();
 const eye=p===1?"#fff8fc":"#49384d";ctx.fillStyle=eye;
 ctx.beginPath();ctx.ellipse(-4.8,-1,1.65,2.5,-0.12,0,Math.PI*2);ctx.fill();
 ctx.beginPath();ctx.ellipse(4.8,-1,1.65,2.5,0.12,0,Math.PI*2);ctx.fill();
 ctx.beginPath();ctx.moveTo(-1.5,3);ctx.lineTo(1.5,3);ctx.lineTo(0.2,4.8);ctx.closePath();ctx.fillStyle="#e982a8";ctx.fill();
 ctx.strokeStyle=eye;ctx.lineWidth=0.8;ctx.lineCap="round";ctx.beginPath();
 ctx.moveTo(-1,5);ctx.quadraticCurveTo(-3,7,-4,5.5);ctx.moveTo(1,5);ctx.quadraticCurveTo(3,7,4,5.5);
 ctx.moveTo(-8,3);ctx.lineTo(-13,2);ctx.moveTo(-8,5);ctx.lineTo(-12,7);
 ctx.moveTo(8,3);ctx.lineTo(13,2);ctx.moveTo(8,5);ctx.lineTo(12,7);ctx.stroke();
 ctx.fillStyle="#ff9cbe66";ctx.beginPath();ctx.ellipse(-7,4,2.1,1.3,0,0,Math.PI*2);ctx.fill();
 ctx.beginPath();ctx.ellipse(7,4,2.1,1.3,0,0,Math.PI*2);ctx.fill();
 if(isLast){ctx.beginPath();ctx.arc(0,0,17.2,0,Math.PI*2);ctx.strokeStyle="#f34c42";ctx.lineWidth=1.8;ctx.stroke();}
 ctx.restore();
}
function draw(b,last=-1){
 const canvas=$("board"),ctx=canvas.getContext("2d");
 const skin=skins.find(x=>x.id===profile.boardSkin)||skins[0];
 const piece=pieceSkins.find(x=>x.id===profile.pieceSkin)||pieceSkins[0];
 const cell=40,offset=32;
 ctx.clearRect(0,0,640,640);ctx.fillStyle=skin.bg;ctx.fillRect(0,0,640,640);
 if(skin.cat){drawPaw(ctx,16,16,1.1);drawPaw(ctx,624,16,1.1);drawPaw(ctx,16,624,1.1);drawPaw(ctx,624,624,1.1);}
 document.body.classList.toggle("cat-theme",!!(skin.cat||piece.cat));
 ctx.strokeStyle=skin.grid;ctx.lineWidth=1.3;
 for(let k=0;k<15;k++){const x=offset+cell*k;ctx.beginPath();ctx.moveTo(offset,x);ctx.lineTo(592,x);ctx.moveTo(x,offset);ctx.lineTo(x,592);ctx.stroke();}
 for(const r of [3,7,11])for(const c of [3,7,11]){ctx.fillStyle=skin.grid;ctx.beginPath();ctx.arc(offset+c*cell,offset+r*cell,3.5,0,7);ctx.fill();}
 for(let i=0;i<CELLS;i++)if(b[i]){
  const x=offset+i%15*cell,y=offset+Math.floor(i/15)*cell;
  if(piece.cat){drawCatPiece(ctx,x,y,b[i],piece,i===last);}
  else{
   ctx.beginPath();ctx.arc(x,y,16.5,0,7);ctx.fillStyle=b[i]===1?piece.black:piece.white;ctx.shadowColor="#0005";ctx.shadowBlur=4;ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle=piece.ring;ctx.lineWidth=piece.gloss?2.6:.8;ctx.stroke();
   if(piece.gloss){ctx.beginPath();ctx.arc(x-4,y-5,4,0,7);ctx.fillStyle="#ffffff66";ctx.fill();}
   if(i===last){ctx.beginPath();ctx.arc(x,y,4.5,0,7);ctx.fillStyle="#f34c42";ctx.fill();}
  }
 }
 if(activeTab==="game"&&hintVisible&&game.turn===1&&!game.result){
  hints.forEach((i,j)=>{if(b[i])return;
   const x=offset+i%15*cell,y=offset+Math.floor(i/15)*cell;
   ctx.beginPath();ctx.arc(x,y,15,0,7);ctx.fillStyle=["#3af7ba99","#70b6ffaa","#ffc77199"][j];ctx.fill();
   ctx.strokeStyle="#f9fff6";ctx.lineWidth=2;ctx.stroke();
   ctx.fillStyle="#172436";ctx.font="bold 17px system-ui";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(String(j+1),x,y);
  });
 }
}
function render(){
 if(!game)return;
 $("identity").textContent=profile.name+" · "+profile.id.slice(0,8);
 $("points").textContent=profile.points;
 $("scoreboard").textContent="胜 "+profile.wins+" / 负 "+profile.losses+" / 平 "+profile.draws;
 $("undoCount").textContent=game.undo;
 $("status").textContent=game.result
  ?(game.cloudSession
    ?(game.syncState==="synced"
      ?({1:"胜利！成绩已验证，获得 "+LEVELS[game.level].reward+" 积分",2:"电脑获胜 · 成绩已同步",3:"平局 · 成绩已同步"}[game.result])
      :game.syncState==="failed"?"本局已结束 · 成绩待同步":"本局已结束 · 正在验证成绩")
    :({1:"胜利！获得 "+LEVELS[game.level].reward+" 积分",2:"电脑获胜",3:"平局"}[game.result]))
  :!game.startedGame?"准备就绪 · 点击「开始下棋」后开始计时":game.turn===1?"轮到你（黑棋）":"电脑思考中";
 $("startGame").disabled=!!game.result||game.startedGame;
 $("startGame").textContent=game.result?"本局已结束":game.startedGame?"计时已开始":"开始下棋";
 $("undo").disabled=!game.startedGame||!!game.result||!game.moves.length||game.turn!==1||remoteBusy;
 const left=Math.max(0,3-game.undo);
 $("undo").textContent=left?"悔棋（剩 "+left+" 次免费）":"悔棋（10 积分/次）";
 $("hint").disabled=!game.startedGame||!!game.result||game.turn!==1||remoteBusy;
 $("review").disabled=!game.moves.length;
 const display=activeTab==="replay"?replay(game.moves)[replayStep]:game.b;
 draw(display,activeTab==="replay"?(replayStep?game.moves[replayStep-1].i:-1):game.moves.at(-1)?.i??-1);
 $("history").innerHTML=game.moves.map((m,j)=>"<button class='move "+(activeTab==="replay"&&replayStep===j+1?"selected":"")+"' data-step='"+(j+1)+"'>"+(j+1)+". "+(m.p===1?"●":"○")+" "+m.coord+" · "+m.seconds.toFixed(1)+"s</button>").join("");
 $("history").querySelectorAll("[data-step]").forEach(x=>x.onclick=()=>{replayStep=Number(x.dataset.step);activate("replay");});
 $("stepLabel").textContent=replayStep+" / "+game.moves.length;
 $("replayList").innerHTML=game.moves.map((m,j)=>"<button class='move "+(replayStep===j+1?"selected":"")+"' data-review='"+(j+1)+"'>"+(j+1)+". "+(m.p===1?"●":"○")+" "+m.coord+"</button>").join("");
 $("replayList").querySelectorAll("[data-review]").forEach(x=>x.onclick=()=>{replayStep=Number(x.dataset.review);render();});
 const m=game.moves[replayStep-1];
 if(!m)$("analysis").textContent="选择一手查看攻防提示。";
 else if(m.quality){
  const q=m.quality;
  $("analysis").textContent="第 "+replayStep+" 手 "+(m.p===1?"玩家":"电脑")+" "+m.coord+
  " · "+q.category+" · 搜索排名 "+q.rank+"/"+q.candidateCount+
  " · Top-1 "+(q.top1?"是":"否")+" · Top-3 "+(q.top3?"是":"否")+
  " · 局面复杂度 "+q.complexity+"（权重 "+q.weight+"）"+
  " · 落子损失 "+q.loss.toFixed(1)+"/200（启发式优势差）"+
  " · 单步准确度 "+(q.accuracy===null?"不计分":q.accuracy+"/100")+
  " · 战术机会 "+(q.opportunity==="attack"?"进攻":q.opportunity==="defense"?"防守":"无")+
  "。推荐："+q.alternatives.map(coord).join("、")+
  "。搜索深度 "+q.depth+" 层；非职业引擎结论。";
 } else $("analysis").textContent=m.analysisError||"正在后台搜索评估这一步……";
 const stats=summarizeQuality(game.moves),completed=stats.ready===stats.total&&stats.total>0;
 const formatRatio=x=>x===null?"未测得":(x*100).toFixed(1)+"%";
 $("qualityScore").textContent=stats.score===null?"—":stats.score+" / 100"+(game.result&&completed?"":" · 临时");
 $("top1Rate").textContent=stats.scored?formatRatio(stats.top1):"—";
 $("top3Rate").textContent=stats.scored?formatRatio(stats.top3):"—";
 $("severeRate").textContent=stats.scored?formatRatio(stats.severeRate):"—";
 $("tacticalRate").textContent=formatRatio(stats.tacticalRate);
 $("attackRate").textContent=stats.attackOpportunities?stats.attackSuccess+" / "+stats.attackOpportunities:"未测得";
 $("defenseRate").textContent=stats.defenseOpportunities?stats.defenseSuccess+" / "+stats.defenseOpportunities:"未测得";
 $("weightedAccuracy").textContent=stats.scored?stats.weightedAccuracy+" / 100":"—";
 $("confidence").textContent=stats.confidence;
 $("effectiveSamples").textContent=String(stats.effectiveSamples);
 $("complexity").textContent="普通 "+stats.complexityCounts.low+" / 中等 "+stats.complexityCounts.medium+
    " / 高 "+stats.complexityCounts.high+" / 关键战术 "+stats.complexityCounts.critical;
 $("qualityNotice").textContent=stats.total?
  ("已分析 "+stats.ready+"/"+stats.total+" 手玩家棋，其中 "+stats.scored+" 手参与评分、"+
   stats.excluded+" 手属于不可避免的直接失利局面。"+stats.confidenceNote+
   (completed&&game.result?" 本局终局分析已完成。":" 当前结果仅作阶段性参考。")):
  "落子后开始后台逐手分析。";
 $("report").textContent=storyForGame(stats);
 const latest=[...game.moves].reverse().find(x=>x.p===1);
 $("recommend").textContent=latest?(latest.quality?
  "最近玩家着 "+latest.coord+"："+latest.quality.category+"；建议 "+latest.quality.alternatives.map(coord).join("、")+"。":
  "最近玩家着 "+latest.coord+"：正在后台计算搜索建议。"):"第一手请落子，系统随后分析。";
 renderShop();
}
function drawSkinPreview(){
 const board=skins.find(x=>x.id===previewBoard)||skins[0];
 const piece=pieceSkins.find(x=>x.id===previewPiece)||pieceSkins[0];
 const c=$("skinPreview"),ctx=c.getContext("2d");
 ctx.clearRect(0,0,360,200);ctx.fillStyle=board.bg;ctx.fillRect(0,0,360,200);
 if(board.cat){drawPaw(ctx,16,16,0.8);drawPaw(ctx,344,16,0.8);drawPaw(ctx,16,184,0.8);drawPaw(ctx,344,184,0.8);}
 ctx.strokeStyle=board.grid;ctx.lineWidth=1;
 for(let x=20;x<=340;x+=40){ctx.beginPath();ctx.moveTo(x,15);ctx.lineTo(x,185);ctx.stroke();}
 for(let y=20;y<=180;y+=40){ctx.beginPath();ctx.moveTo(15,y);ctx.lineTo(345,y);ctx.stroke();}
 for(const [x,y,p] of [[140,100,1],[180,100,2],[220,100,1],[180,60,2],[140,140,2],[220,140,1]]){
  if(piece.cat){drawCatPiece(ctx,x,y,p,piece,false);}
  else{
   ctx.beginPath();ctx.arc(x,y,16,0,7);ctx.fillStyle=p===1?piece.black:piece.white;
   ctx.shadowColor="#0008";ctx.shadowBlur=6;ctx.fill();ctx.shadowBlur=0;
   ctx.lineWidth=piece.gloss?3:1;ctx.strokeStyle=piece.ring;ctx.stroke();
   if(piece.gloss){ctx.beginPath();ctx.arc(x-5,y-5,4,0,7);ctx.fillStyle="#ffffff88";ctx.fill();}
  }
 }
 $("skinPreviewTitle").textContent=board.name+" + "+piece.name;
}
function storyForGame(stats){
 const n=stats.total,score=stats.score;
 if(!n)return "棋盘刚刚铺开，黑白两军都在等你写下第一笔。来吧，天元附近或许藏着故事的开头！";
 const intro=game.result===1?"漂亮！这局你把胜利装进口袋，棋盘可以为你鼓掌了。":
 game.result===2?"这局电脑抢先连五，但精彩的对抗不只看终点，复盘还有翻盘线索。":
 game.result===3?"棋盘被塞得满满当当，双方握手言和，这是一场耐心拉锯战。":
 "战局正在发酵，棋子像在写悬疑小说：下一手也许就是伏笔。";
 const quality=score===null?"分析师还在翻棋谱，暂时先不贴分数标签。":
 score>=90?"目前落子相当利落，像提前看过剧本。":
 score>=75?"思路挺清楚，偶尔绕路，但攻防节奏跟得上。":
 score>=55?"棋形意识正在长出来，几个关键转折值得回头看看。":
 "这盘有些惊险转角，建议挑几手失误点复盘，提升会很快。";
 const chances=stats.tacticalOpportunities
 ? ("出现 "+stats.tacticalOpportunities+" 次明确的关键攻防机会，你成功处理了 "+
 (stats.attackSuccess+stats.defenseSuccess)+" 次。")
 : "本局尚无算法确认的直接攻防机会，这一项先留白，不随便扣分。";
 const end="你共下了 "+n+" 手，"+(game.result?"本局":"当前")+"用掉 "+game.undo+
 " 次悔棋；评分可信度："+stats.confidence+"。"+
 (stats.ready<stats.total?"还有 "+(stats.total-stats.ready)+" 手等待后台分析。":"");
 return intro+" "+quality+" "+chances+" "+end;
}
function renderShop(){
 function card(kind,item){
  const key=kind+":"+item.id,owned=profile.owned.includes(key)||(kind==="board"&&profile.owned.includes(item.id));
  const selected=(kind==="board"?profile.boardSkin:profile.pieceSkin)===item.id;
  const affordable=profile.points>=item.cost;
  return "<article class='skin'><span class='swatch' style='background:"+
   (kind==="board"?item.bg:item.black)+";border-color:"+
   (kind==="board"?item.grid:item.ring)+"'></span><div><b>"+item.name+
   "</b><small>"+(item.cost?item.cost+" 积分":"免费")+"</small></div>"+
   "<div class='controls'><button data-preview='"+kind+":"+item.id+"'>试穿</button>"+
   "<button data-buy='"+kind+":"+item.id+"' "+(selected||(!owned&&!affordable)?"disabled":"")+">"+
   (selected?"使用中":owned?"装备":affordable?"兑换":"积分不足")+"</button></div></article>";
 }
 $("boardShop").innerHTML=skins.map(s=>card("board",s)).join("");
 $("pieceShop").innerHTML=pieceSkins.map(s=>card("piece",s)).join("");
 document.querySelectorAll("[data-preview]").forEach(button=>button.onclick=()=>{
  const [kind,id]=button.dataset.preview.split(":");
  if(kind==="board")previewBoard=id;else previewPiece=id;
  drawSkinPreview();
 });
 document.querySelectorAll("[data-buy]").forEach(button=>button.onclick=async()=>{
  const [kind,id]=button.dataset.buy.split(":");
  const item=(kind==="board"?skins:pieceSkins).find(x=>x.id===id);
  if(!item)return;
  const key=kind+":"+id,owned=profile.owned.includes(key)||(kind==="board"&&profile.owned.includes(id));
  if(!owned&&profile.points<item.cost){alert("积分不足");return;}
  if(!owned&&!confirm("使用 "+item.cost+" 积分永久解锁「"+item.name+"」？"))return;
  if(cloudMode()){
   try{const result=await api("shop",{kind,item:id});applyRemoteProfile(result.profile);}
   catch(e){alert("云端兑换失败："+e.message);return;}
  }else{
   if(!owned){profile.points-=item.cost;profile.owned.push(key);}
   if(kind==="board")profile.boardSkin=id;else profile.pieceSkin=id;
   save();
  }
  previewBoard=profile.boardSkin;previewPiece=profile.pieceSkin;
  render();
 });
 drawSkinPreview();
}
function formatTime(){if(!game)return;if(!game.startedGame){$("totalTime").textContent="00:00";$("thinkTime").textContent="未开始";return;}const now=game.ended||performance.now(),total=Math.max(0,Math.floor((now-game.started)/1000));$("totalTime").textContent=String(Math.floor(total/60)).padStart(2,"0")+":"+String(total%60).padStart(2,"0");$("thinkTime").textContent=game.result?"已停止":game.turn===1?((performance.now()-game.turnStart)/1000).toFixed(1)+"s":"AI 行棋";}
function download(){const payload={version:"2.3",identity:profile.id,level:game.level,moves:game.moves,events:game.events,undoCount:game.undo,result:game.result,qualitySummary:summarizeQuality(game.moves)};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="gomoku-v2.3-game.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
async function localRank(){
 const rankPoints=(earned,wins,losses,draws)=>{
  const games=wins+losses+draws;
  const adjusted=games?100*(wins+2.5)/(games+5):0;
  const composite=Math.round(Number(earned||0)+(adjusted-50)*Math.min(games,20)/10);
  return Math.max(0,composite);
 };
 if(cloudMode()){
  try{
   const result=await api("leaderboard");
   $("leaderboardMode").textContent="按综合积分降序排名。胜利奖励按 AI 难度累计（新手 10、进阶 30、大师 80）；胜率高于 50% 时增加修正分，低于 50% 时相应扣分，最多按 20 局修正。原始胜率单独展示，消费积分不影响排名。";
   $("rankRows").innerHTML=result.players.map((p,i)=>{
    const wins=Number(p.wins||0),losses=Number(p.losses||0),draws=Number(p.draws||0);
    const games=Number(p.games_played??(wins+losses+draws));
    const winRate=Number(p.win_rate??(games?100*wins/games:0));
    const score=Number(p.rank_points??rankPoints(p.earned_points,wins,losses,draws));
    return "<tr><td>"+(i+1)+"</td><td>"+escapeText(p.name)+"</td><td>"+wins+"</td><td>"+games+"</td><td>"+winRate.toFixed(1)+"%</td><td>"+score+"</td></tr>";
   }).join("");
   return;
  }catch(e){$("leaderboardMode").textContent="排行榜暂不可用："+e.message;return;}
 }
 const wins=Number(profile.wins||0),losses=Number(profile.losses||0),draws=Number(profile.draws||0);
 const games=wins+losses+draws,winRate=games?100*wins/games:0;
 const earned=Number(profile.earnedPoints??profile.points??0);
 const score=rankPoints(earned,wins,losses,draws);
 $("leaderboardMode").textContent="本地模式：仅显示当前浏览器玩家；排名按综合积分计算，游客榜单不参与云端排名。";
 $("rankRows").innerHTML="<tr><td>1</td><td>"+escapeText(profile.name)+"</td><td>"+wins+"</td><td>"+games+"</td><td>"+winRate.toFixed(1)+"%</td><td>"+score+"</td></tr>";
}
function escapeText(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function setName(){const name=$("nickname").value.trim().slice(0,24);if(name.length<2||name.length>24||/[<>]/.test(name)){alert("显示名称需为 2–24 个字符，且不能包含 < 或 >");return;}if(cloudMode()){try{const v=await api("name",{name});applyRemoteProfile(v.profile);}catch(e){alert("保存失败："+e.message);return;}}else{profile.name=name;save();}if($("accountDisplayName"))$("accountDisplayName").value=profile.name;render();localRank();}
for(const name of ["game","replay","store","leaderboard","account"])$("tab-"+name).onclick=()=>activate(name);
$("board").addEventListener("click",e=>{
 if(activeTab!=="game")return;
 const rect=$("board").getBoundingClientRect(),x=(e.clientX-rect.left)*640/rect.width,y=(e.clientY-rect.top)*640/rect.height;
 const c=Math.round((x-32)/40),r=Math.round((y-32)/40);
 if(inside(r,c)&&Math.hypot(x-(32+c*40),y-(32+r*40))<19)human(spot(r,c));
});
$("newGame").onclick=newGame;
$("startGame").onclick=startGame;
$("soundToggle").onclick=()=>{
 soundEnabled=!soundEnabled;localStorage.setItem(SOUND_STORE,soundEnabled?"on":"off");
 updateSoundToggle();if(soundEnabled)playMoveSound(1);
};
$("retrySync").onclick=()=>syncPendingSubmissions();
window.addEventListener("online",()=>syncPendingSubmissions());
$("undo").onclick=undo;
$("hint").onclick=hintMove;
$("review").onclick=()=>{replayStep=game.moves.length;activate("replay");};
$("prev").onclick=()=>{replayStep=Math.max(0,replayStep-1);render();};
$("next").onclick=()=>{replayStep=Math.min(game.moves.length,replayStep+1);render();};
$("start").onclick=()=>{replayStep=0;render();};
$("end").onclick=()=>{replayStep=game.moves.length;render();};
$("export").onclick=download;
$("setName").onclick=setName;
$("difficulty").onchange=()=>{if(game.startedGame&&!game.result){$("difficulty").value=game.level;alert("请先结束或新开一局再更改难度。");}};
$("cloudBanner").textContent=cloudConfigured()?"账号服务可连接，未登录时使用游客模式":"游客模式 · 账号服务尚未配置";
newGame();updateSoundToggle();
initAccount(async signedIn=>{
 if(signedIn&&cloudConfigured()){
  try{const v=await api("profile",{});applyRemoteProfile(v.profile);$("cloudBanner").textContent="云端账号已连接";}
  catch(e){$("cloudBanner").textContent="云端身份验证失败："+e.message;}
 }else {profile=loadProfile();$("cloudBanner").textContent="游客模式 · 数据保存在此浏览器";}
 await newGame();await localRank();render();
 if(signedIn)await syncPendingSubmissions();
},remoteProfile=>{applyRemoteProfile(remoteProfile);if(document.activeElement!==$("nickname"))$("nickname").value=remoteProfile.name||"";render();localRank();}).catch(e=>$("cloudBanner").textContent="账号组件错误："+e.message);
localRank();setInterval(formatTime,150);
