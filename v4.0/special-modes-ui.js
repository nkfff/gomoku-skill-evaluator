import {bearer, loggedIn, cloudConfigured} from "./src/account.js";
import {
  PUZZLE_LEVELS, generatePuzzle, findPuzzleSolution, createRandomConfig,
  modeWinLine, chooseRandomMove, validatePuzzleSolution
} from "./src/special-modes.js";

const $=id=>document.getElementById(id);
const API=(window.GOMOKU_PVP_API_URL||"").replace(/\/$/,"");
const CLAIMS_KEY="gomoku-v3.4-puzzle-claims";
const BOARD_THEMES={
  classic:{bg:"#dcb77b",grid:"#815830"},jade:{bg:"#a8c8b2",grid:"#42725b"},
  night:{bg:"#24283b",grid:"#65729b"},cherry:{bg:"#f0c8cd",grid:"#a96a76"},
  catcafe:{bg:"#fff1f6",grid:"#c7789a",cat:true},gold:{bg:"#3c3131",grid:"#ac884a"}
};
const PIECE_THEMES={
  classic:{black:"#18191e",white:"#fffdf4",ring:"#74706d"},
  crystal:{black:"#2367b3",white:"#d5faff",ring:"#86d3ff",gloss:true},
  ink:{black:"#14262c",white:"#f5e9d8",ring:"#c28d5e"},
  neon:{black:"#bb35fe",white:"#42f7ed",ring:"#f0a4ff",gloss:true},
  pearl:{black:"#2c182a",white:"#ffdcf0",ring:"#d7a0b9",gloss:true},
  cat:{black:"#30273f",white:"#fff8fc",ring:"#ee8db2",gloss:true,cat:true}
};
let puzzleState=null,puzzleBusy=false,randomState=null,aiTimer=null;

const randomAIWorker = typeof Worker !== "undefined" ? new Worker(new URL("./src/ai.worker.js", import.meta.url), {type:"module"}) : null;
const randomAIRequests = new Map();
let randomAIRequestId = 0;
if(randomAIWorker){
 randomAIWorker.onmessage=({data})=>{
  const pending=randomAIRequests.get(data.requestId);
  if(!pending)return;
  randomAIRequests.delete(data.requestId);
  if(data.error)pending.reject(new Error(data.error));
  else pending.resolve(data.result.index);
 };
 randomAIWorker.onerror=()=>{
  for(const pending of randomAIRequests.values())pending.reject(new Error("随机模式 AI Worker 不可用"));
  randomAIRequests.clear();
 };
}
function requestRandomAI(board,size,connect,player){
 if(!randomAIWorker)return Promise.resolve().then(()=>chooseRandomMove(board,size,connect,player));
 const requestId=++randomAIRequestId;
 return new Promise((resolve,reject)=>{
  randomAIRequests.set(requestId,{resolve,reject});
  randomAIWorker.postMessage({requestId,mode:"random",board,size,connect,player});
 });
}

function randomSeed(){
  const a=new Uint32Array(1);
  if(globalThis.crypto&&crypto.getRandomValues)crypto.getRandomValues(a);
  else a[0]=(Date.now()^Math.floor(Math.random()*0xffffffff))>>>0;
  return a[0]||1;
}
function isCloudUser(){return loggedIn()&&cloudConfigured()&&!!API;}
async function modeApi(path,payload){
  const token=await bearer();
  if(!token)throw new Error("请先登录账号，或切换为游客模式进行本地挑战");
  const response=await fetch(API+"/api/modes/puzzle/"+path,{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
    body:JSON.stringify(payload||{})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||"残局服务暂时不可用");
  return result;
}
function loadClaims(){
  try{const v=JSON.parse(localStorage.getItem(CLAIMS_KEY)||"[]");return new Set(Array.isArray(v)?v:[]);}
  catch{return new Set();}
}
const localClaims=loadClaims();
function saveClaim(id){
  localClaims.add(id);
  localStorage.setItem(CLAIMS_KEY,JSON.stringify([...localClaims].slice(-200)));
}
function coord(index,size){
  let n=index%size+1,label="";
  while(n>0){n--;label=String.fromCharCode(65+n%26)+label;n=Math.floor(n/26);}
  return label+(Math.floor(index/size)+1);
}
function themes(){
  const boardId=document.body.dataset.boardTheme||"classic";
  const pieceId=document.body.dataset.pieceTheme||"classic";
  return {board:BOARD_THEMES[boardId]||BOARD_THEMES.classic,piece:PIECE_THEMES[pieceId]||PIECE_THEMES.classic};
}
function paw(ctx,x,y,scale){
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.fillStyle="#e89fbd66";
  for(const [px,py,rx,ry] of [[-6,-4,2.5,3],[0,-7,2.5,3],[6,-4,2.5,3]]){ctx.beginPath();ctx.ellipse(px,py,rx,ry,0,0,Math.PI*2);ctx.fill();}
  ctx.beginPath();ctx.ellipse(0,2,7,5,0,0,Math.PI*2);ctx.fill();ctx.restore();
}
function catStone(ctx,x,y,player,piece,radius){
  ctx.save();ctx.translate(x,y);ctx.scale(radius/15,radius/15);
  ctx.beginPath();ctx.moveTo(-12,-5);ctx.lineTo(-10,-14);ctx.lineTo(-3,-10);
  ctx.quadraticCurveTo(0,-12,3,-10);ctx.lineTo(10,-14);ctx.lineTo(12,-5);
  ctx.arc(0,1,12,-0.1,Math.PI+0.1);ctx.closePath();
  ctx.fillStyle=player===1?piece.black:piece.white;ctx.shadowColor="#0004";ctx.shadowBlur=3;ctx.fill();ctx.shadowBlur=0;
  ctx.strokeStyle=piece.ring;ctx.lineWidth=1.2;ctx.stroke();
  const eye=player===1?"#fff8fc":"#49384d";ctx.fillStyle=eye;ctx.beginPath();
  ctx.ellipse(-4.5,-1,1.5,2.2,-0.12,0,Math.PI*2);ctx.ellipse(4.5,-1,1.5,2.2,0.12,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#e982a8";ctx.beginPath();ctx.moveTo(-1.5,3);ctx.lineTo(1.5,3);ctx.lineTo(0,4.7);ctx.closePath();ctx.fill();
  ctx.restore();
}
function drawBoard(canvas,board,size,connect,last=-1,highlight=-1){
  if(!canvas)return;
  const ctx=canvas.getContext("2d"),dim=canvas.width,offset=32,cell=(dim-offset*2)/(size-1);
  const skin=themes().board,piece=themes().piece;
  ctx.clearRect(0,0,dim,dim);ctx.fillStyle=skin.bg;ctx.fillRect(0,0,dim,dim);
  if(skin.cat){paw(ctx,16,16,1.1);paw(ctx,dim-16,16,1.1);paw(ctx,16,dim-16,1.1);paw(ctx,dim-16,dim-16,1.1);}
  ctx.strokeStyle=skin.grid;ctx.lineWidth=size>=23?0.8:1.2;
  for(let k=0;k<size;k++){
    const p=offset+cell*k;ctx.beginPath();ctx.moveTo(offset,p);ctx.lineTo(dim-offset,p);ctx.moveTo(p,offset);ctx.lineTo(p,dim-offset);ctx.stroke();
  }
  if(size===15)for(const r of [3,7,11])for(const c of [3,7,11]){
    ctx.beginPath();ctx.arc(offset+cell*c,offset+cell*r,3,0,Math.PI*2);ctx.fillStyle=skin.grid;ctx.fill();
  }
  const radius=Math.min(16,cell*0.38);
  for(let i=0;i<board.length;i++)if(board[i]){
    const x=offset+(i%size)*cell,y=offset+Math.floor(i/size)*cell;
    if(piece.cat)catStone(ctx,x,y,board[i],piece,radius);
    else{
      ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fillStyle=board[i]===1?piece.black:piece.white;
      ctx.shadowColor="#0005";ctx.shadowBlur=3;ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle=piece.ring;ctx.lineWidth=piece.gloss?1.8:0.8;ctx.stroke();
      if(piece.gloss&&radius>7){ctx.beginPath();ctx.arc(x-radius*.28,y-radius*.32,Math.max(1.5,radius*.2),0,Math.PI*2);ctx.fillStyle="#ffffff66";ctx.fill();}
    }
    if(i===last){ctx.beginPath();ctx.arc(x,y,radius+3,0,Math.PI*2);ctx.strokeStyle="#f34c42";ctx.lineWidth=2;ctx.stroke();}
  }
  if(highlight>=0){
    const x=offset+(highlight%size)*cell,y=offset+Math.floor(highlight/size)*cell;
    ctx.beginPath();ctx.arc(x,y,radius+4,0,Math.PI*2);ctx.strokeStyle="#23b779";ctx.lineWidth=3;ctx.stroke();
  }
}
function clickedIndex(event,canvas,size){
  const rect=canvas.getBoundingClientRect(),dim=canvas.width,offset=32,cell=(dim-offset*2)/(size-1);
  const x=(event.clientX-rect.left)*dim/rect.width,y=(event.clientY-rect.top)*dim/rect.height;
  const col=Math.round((x-offset)/cell),row=Math.round((y-offset)/cell);
  if(row<0||row>=size||col<0||col>=size)return -1;
  if(Math.hypot(x-(offset+col*cell),y-(offset+row*cell))>cell*0.46)return -1;
  return row*size+col;
}
function renderPuzzle(){
  if(!puzzleState)return;
  const p=puzzleState,level=PUZZLE_LEVELS[p.difficulty];
  $("puzzleLevelLabel").textContent=level.label;
  $("puzzleObjective").textContent=level.objective;
  $("puzzleReward").textContent="+"+p.reward;
  drawBoard($("puzzleBoard"),p.board,p.size,p.connect,p.lastMove??-1,p.showSolution?(p.solutionSequence?.[Math.min(p.step||0,p.solutionSequence.length-1)]??p.solutionIndex):-1);
  $("puzzleHint").disabled=p.solved;
  $("puzzleRetryClaim").hidden=!p.solved||p.claimed||!p.server;
  $("puzzleRewardStatus").textContent=p.claimed
    ?("已领取 +"+p.reward+" 积分。"+(p.server?"奖励已记入云端账号。":"游客奖励保存在当前浏览器。"))
    :("通关奖励 +"+p.reward+" 积分"+(p.server?"（服务器验证，单题只能领取一次）":"（游客模式保存在本浏览器）"));
}
async function newPuzzle(){
  if(puzzleBusy)return;
  puzzleBusy=true;
  $("puzzleStatus").textContent="正在生成并验证残局…";
  $("puzzleNew").disabled=true;$("puzzleHint").disabled=true;$("puzzleRetryClaim").hidden=true;
  try{
    const difficulty=$("puzzleDifficulty").value;
    if(isCloudUser()){
      const result=await modeApi("new",{difficulty});
      const p=result.puzzle;
      const solution=findPuzzleSolution(p.board,difficulty,p.size,p.connect);
      if(solution===null)throw new Error("服务器返回的多步残局未通过本地校验，请重新生成");
      const row=Math.floor(solution/p.size),col=solution%p.size;
      const sequence=[solution,row*p.size+col-3,(row-3)*p.size+col];
      const verified={...p,solutionIndex:solution,solutionSequence:sequence,difficulty};
      if(!validatePuzzleSolution(verified))throw new Error("服务器返回的残局未通过完整多步唯一解验证，请重新生成");
      puzzleState={...verified,server:true,solved:false,claimed:false,showSolution:false,step:0,lastMove:-1,playedSequence:[]};
    }else{
      const puzzle=generatePuzzle(difficulty,randomSeed());
      puzzleState={...puzzle,id:"guest-"+difficulty+"-"+puzzle.seed,server:false,solved:false,claimed:false,showSolution:false,step:0,lastMove:-1,playedSequence:[]};
    }
    $("puzzleStatus").textContent="黑棋先手。请先找到唯一正确的起手点；随后需要应对对手封堵，再完成最后一手。"+(puzzleState.server?"本题 20 分钟内有效。":"");
    renderPuzzle();
  }catch(error){
    $("puzzleStatus").textContent="生成失败："+error.message;
  }finally{
    puzzleBusy=false;$("puzzleNew").disabled=false;
    $("puzzleHint").disabled=!puzzleState||puzzleState.solved;
  }
}
async function claimPuzzleReward(){
  if(!puzzleState||!puzzleState.solved||puzzleState.claimed||puzzleBusy)return;
  puzzleBusy=true;$("puzzleRetryClaim").hidden=true;
  try{
    if(puzzleState.server){
      const result=await modeApi("claim",{challengeId:puzzleState.id,moveSequence:puzzleState.playedSequence});
      if(result.profile&&window.gomokuApplyModeProfile)window.gomokuApplyModeProfile(result.profile);
    }else{
      if(localClaims.has(puzzleState.id)){
        puzzleState.claimed=true;
        $("puzzleStatus").textContent="这道残局已经领取过奖励。再生成一道新题继续挑战吧。";
        renderPuzzle();return;
      }
      const awarded=window.gomokuAwardLocalModePoints&&window.gomokuAwardLocalModePoints(puzzleState.reward);
      if(!awarded)throw new Error("本地积分模块暂不可用，请刷新页面后重试");
      saveClaim(puzzleState.id);
    }
    puzzleState.claimed=true;
    $("puzzleStatus").textContent="漂亮！你完成了唯一解的多步组合："+puzzleState.playedSequence.map(i=>coord(i,puzzleState.size)).join(" → ")+"，获得 +"+puzzleState.reward+" 积分。";
    renderPuzzle();
  }catch(error){
    $("puzzleStatus").textContent="棋题已解出，但积分同步失败："+error.message+"。可以点击“重试领取积分”。";
    $("puzzleRetryClaim").hidden=false;
  }finally{puzzleBusy=false;}
}
function onPuzzleClick(event){
  const p=puzzleState;
  if(!p||puzzleBusy||p.solved||p.step===1)return;
  const index=clickedIndex(event,$("puzzleBoard"),p.size);
  if(index<0||p.board[index])return;
  const expected=p.solutionSequence[p.step===0?0:2];
  if(index!==expected){
    $("puzzleStatus").textContent=p.step===0
      ?"这一步不是正确的起手点。请寻找能够同时制造两处后续制胜点的落子。"
      :"这一步没有利用对手封堵后的另一条制胜线，请重新观察棋形。";
    return;
  }
  p.board[index]=1;p.lastMove=index;p.playedSequence.push(index);p.showSolution=false;
  if(p.step===0){
    p.step=1;
    $("puzzleStatus").textContent="正确！你制造了双路威胁。对手正在封堵其中一路…";
    renderPuzzle();
    window.setTimeout(()=>{
      if(puzzleState!==p||p.solved)return;
      const response=p.solutionSequence[1];
      if(p.board[response]){ $("puzzleStatus").textContent="棋题状态异常，请重新生成。";return; }
      p.board[response]=2;p.lastMove=response;p.playedSequence.push(response);p.step=2;
      $("puzzleStatus").textContent="对手已封堵一路。现在请完成最后一手，利用另一条制胜线。";
      renderPuzzle();
    },420);
    return;
  }
  p.step=3;p.solved=true;p.showSolution=true;
  $("puzzleStatus").textContent="组合完成！正在验证通关奖励…";
  renderPuzzle();claimPuzzleReward();
}
function showPuzzleHint(){
  if(!puzzleState||puzzleState.solved)return;
  puzzleState.showSolution=true;
  const next=puzzleState.solutionSequence[puzzleState.step===0?0:2];
  $("puzzleStatus").textContent="提示：当前这一步可以落在 "+coord(next,puzzleState.size)+"。";
  renderPuzzle();
}
function renderRandom(){
  if(!randomState)return;
  const g=randomState;
  $("randomBoardSize").textContent=g.size+" × "+g.size;
  $("randomConnect").textContent=g.connect+" 连珠";
  $("randomTurn").textContent=g.result?(g.result===1?"你获胜":g.result===2?"AI 获胜":"和棋"):g.thinking?"AI 思考中":g.turn===1?"你（黑棋）":"AI（白棋）";
  drawBoard($("randomBoard"),g.board,g.size,g.connect,g.last,-1);
}
function randomStatus(text){$("randomStatus").textContent=text;}
function finishRandom(result){
  randomState.result=result;randomState.turn=0;randomState.thinking=false;
  if(result===1)randomStatus("恭喜！你赢下 "+randomState.connect+" 连珠。点击“随机开局”挑战新的棋盘。");
  else if(result===2)randomStatus("AI 完成 "+randomState.connect+" 连珠。再试一局，棋盘与连珠数都会变化。");
  else randomStatus("棋盘已满，本局和棋。重新开局会生成更大的随机组合。");
  renderRandom();
}
function placeRandom(index,player){
  const g=randomState;
  if(!g||g.board[index])return false;
  g.board[index]=player;g.last=index;g.moves++;
  if(modeWinLine(g.board,index,player,g.size,g.connect).length){finishRandom(player);return true;}
  if(g.board.every(Boolean)){finishRandom(3);return true;}
  g.turn=3-player;renderRandom();
  return false;
}
function newRandomGame(newConfig=true){
  if(aiTimer)clearTimeout(aiTimer);aiTimer=null;
  const previous=randomState;
  const config=!newConfig&&previous
    ?{size:previous.size,connect:previous.connect,seed:previous.seed}
    :createRandomConfig(randomSeed());
  randomState={...config,board:Array(config.size*config.size).fill(0),turn:1,result:0,last:-1,moves:0,thinking:false};
  randomStatus("新棋局已生成：棋盘 "+config.size+" × "+config.size+"，"+config.connect+" 连珠。你执黑先手。");
  renderRandom();
}
function onRandomClick(event){
  const g=randomState;
  if(!g||g.result||g.turn!==1||g.thinking)return;
  const index=clickedIndex(event,$("randomBoard"),g.size);
  if(index<0||g.board[index])return;
  if(placeRandom(index,1))return;
  g.thinking=true;randomStatus("AI 正在计算落点…");renderRandom();
  aiTimer=setTimeout(async()=>{
    aiTimer=null;
    if(!randomState||randomState!==g||g.result)return;
    try{
      const move=await requestRandomAI(g.board.slice(),g.size,g.connect,2);
      if(!randomState||randomState!==g||g.result||g.turn!==2)return;
      g.thinking=false;
      if(!Number.isInteger(move)||move<0||g.board[move]){finishRandom(3);return;}
      if(!placeRandom(move,2)){
        g.turn=1;randomStatus("轮到你。目标是连成 "+g.connect+" 子。");renderRandom();
      }
    }catch(error){
      if(randomState===g&&!g.result){
        g.thinking=false;g.turn=1;
        randomStatus("AI 计算失败，请重新落子："+error.message);renderRandom();
      }
    }
  },100);
}
$("puzzleNew").addEventListener("click",newPuzzle);
$("puzzleHint").addEventListener("click",showPuzzleHint);
$("puzzleRetryClaim").addEventListener("click",claimPuzzleReward);
$("puzzleBoard").addEventListener("click",onPuzzleClick);
$("randomNew").addEventListener("click",()=>newRandomGame(true));
$("randomRestart").addEventListener("click",()=>newRandomGame(false));
$("randomBoard").addEventListener("click",onRandomClick);
window.addEventListener("gomoku:tab-change",event=>{
  const tab=event.detail&&event.detail.tab;
  if(tab==="puzzle"&&!puzzleState)newPuzzle();
  if(tab==="random"&&!randomState)newRandomGame(true);
  if(tab==="puzzle")renderPuzzle();
  if(tab==="random")renderRandom();
});
window.addEventListener("gomoku:profile-updated",()=>{
  if(puzzleState && !puzzleState.solved && puzzleState.server!==isCloudUser() && !$("panel-puzzle").hidden) newPuzzle();
  else if(puzzleState) renderPuzzle();
  if(randomState)renderRandom();
});
