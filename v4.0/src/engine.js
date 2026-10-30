// Shared, deterministic game rules and computer engine (browser + Worker).
export const SIZE = 15;
export const CELLS = SIZE * SIZE;
export const LEVELS = {
  easy:   {label:"新手",reward:10,depth:0,width:6,timeMs:0,maxDepth:1},
  normal: {label:"进阶",reward:30,depth:5,width:10,timeMs:650,maxDepth:6},
  hard:   {label:"王者",reward:80,depth:14,width:14,timeMs:2400,maxDepth:14}
};
export const inside = (r,c)=>r>=0&&r<15&&c>=0&&c<15;
export const spot = (r,c)=>r*15+c;
export const coord = i=>"ABCDEFGHIJKLMNO"[i%15]+String(Math.floor(i/15)+1);
const DIRS = [[0,1],[1,0],[1,1],[1,-1]];
export function winLine(b,i,p){
  const r=Math.floor(i/15),c=i%15;
  for(const [dr,dc] of DIRS){
    const cells=[i];
    for(const sign of [-1,1]){
      let y=r+dr*sign,x=c+dc*sign;
      while(inside(y,x)&&b[spot(y,x)]===p){cells.push(spot(y,x));y+=dr*sign;x+=dc*sign;}
    }
    if(cells.length>=5)return cells;
  }
  return [];
}
export function candidates(b,radius=2){
  const s=new Set();
  for(let i=0;i<CELLS;i++)if(b[i]){
    const r=Math.floor(i/15),c=i%15;
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
      if(inside(r+dy,c+dx)){const j=spot(r+dy,c+dx);if(!b[j])s.add(j);}
    }
  }
  return s.size?[...s]:[112];
}
export function immediateWins(b,p,possible=candidates(b)){
  const out=[];
  for(const i of possible){
    if(b[i])continue;
    b[i]=p;
    if(winLine(b,i,p).length)out.push(i);
    b[i]=0;
  }
  return out;
}
export function pointShape(b,i,p){
  if(b[i])return {score:-Infinity,kind:"occupied"};
  let score=0,threes=0,fours=0,open4=0;
  const r=Math.floor(i/15),c=i%15;
  for(const [dy,dx] of DIRS){
    let s="";
    for(let k=-5;k<=5;k++){
      const y=r+dy*k,x=c+dx*k;
      const v=k===0?p:inside(y,x)?b[spot(y,x)]:-1;
      s+=v===p?"X":v===0?".":"O";
    }
    let type=0;
    if(s.includes("XXXXX"))return {score:100000000,kind:"win"};
    if(s.includes(".XXXX.")){type=3500000;open4++;fours++;}
    else if(["XXXX.",".XXXX","XXX.X","XX.XX","X.XXX"].some(x=>s.includes(x))){type=90000;fours++;}
    else if([".XXX.",".XX.X.",".X.XX."].some(x=>s.includes(x))){type=24000;threes++;}
    else if(["XXX.",".XXX","XX.X","X.XX"].some(x=>s.includes(x)))type=2300;
    else if([".XX.",".X.X."].some(x=>s.includes(x)))type=800;
    else type=24;
    score+=type;
  }
  if(fours>=2)score+=4500000;
  if(fours&&threes)score+=2700000;
  if(threes>=2)score+=180000;
  return {score,threes,fours,open4,kind:open4?"活四":fours>=2?"双四":fours?"冲四":threes>=2?"双活三":threes?"活三":"普通"};
}
export function pointValue(b,i,p){
  const own=pointShape(b,i,p).score;
  const block=pointShape(b,i,3-p).score;
  const r=Math.floor(i/15),c=i%15;
  return own*1.12+block*0.99+(14-Math.abs(r-7)-Math.abs(c-7))*0.5;
}
export function rankedMoves(b,p,width=8){
  const possible=candidates(b);
  const wins=immediateWins(b,p,possible);
  if(wins.length)return wins;
  const threats=immediateWins(b,3-p,possible);
  if(threats.length)return threats;
  return possible.sort((a,z)=>pointValue(b,z,p)-pointValue(b,a,p)||a-z).slice(0,width);
}
function estimate(b,p){
  const cand=candidates(b,2);
  let own1=0,own2=0,opp1=0,opp2=0,ownThreats=0,oppThreats=0;
  for(const i of cand){
    const own=pointShape(b,i,p).score,opp=pointShape(b,i,3-p).score;
    if(own>own1){own2=own1;own1=own;}else if(own>own2)own2=own;
    if(opp>opp1){opp2=opp1;opp1=opp;}else if(opp>opp2)opp2=opp;
    if(own>=90000)ownThreats++;
    if(opp>=90000)oppThreats++;
  }
  return own1*1.18+own2*.24-opp1*1.22-opp2*.27
    +Math.min(ownThreats,2)*12000-Math.min(oppThreats,2)*15000;
}
const MATE_SCORE=1e12;
const SEARCH_TIMEOUT=Symbol("search-timeout");
const ZOBRIST_LO=new Uint32Array(CELLS*3);
const ZOBRIST_HI=new Uint32Array(CELLS*3);
let zobristSeed=0x6d2b79f5;
function nextZobrist(){
  zobristSeed^=zobristSeed<<13;
  zobristSeed^=zobristSeed>>>17;
  zobristSeed^=zobristSeed<<5;
  return zobristSeed>>>0;
}
for(let i=0;i<CELLS*3;i++){
  ZOBRIST_LO[i]=nextZobrist();
  ZOBRIST_HI[i]=nextZobrist();
}
function hashBoard(b){
  let lo=0,hi=0;
  for(let i=0;i<CELLS;i++)if(b[i]){
    const key=i*3+b[i];
    lo=(lo^ZOBRIST_LO[key])>>>0;
    hi=(hi^ZOBRIST_HI[key])>>>0;
  }
  return [lo,hi];
}
function orderedSearchMoves(b,p,width,ttMove=-1,possible=candidates(b,2)){
  const wins=immediateWins(b,p,possible);
  if(wins.length)return wins;
  const threats=immediateWins(b,3-p,possible);
  if(threats.length===1)return threats;
  const scored=[];
  for(const i of possible){
    const own=pointShape(b,i,p),block=pointShape(b,i,3-p);
    const r=Math.floor(i/SIZE),c=i%SIZE;
    let score=own.score*1.12+block.score*1.02+(14-Math.abs(r-7)-Math.abs(c-7))*.5;
    if(i===ttMove)score+=1e15;
    if(threats.includes(i))score+=1e13;
    if(own.score>=24000||own.fours||own.threes>=2){
      b[i]=p;
      const forks=immediateWins(b,p).length;
      b[i]=0;
      if(forks>=2)score+=5e11;
      else if(forks===1)score+=2e7;
    }
    scored.push({i,score});
  }
  scored.sort((a,z)=>z.score-a.score||a.i-z.i);
  return scored.slice(0,width).map(x=>x.i);
}
export function chooseAI(b,level="normal",options={}){
  if(!Array.isArray(b)||b.length!==CELLS)return {index:-1,reason:"棋盘数据无效",nodes:0,depth:0};
  if(!b.some(v=>v===0))return {index:-1,reason:"棋盘已满",nodes:0,depth:0};
  const aiPlayer=options.player===1?1:2,humanPlayer=3-aiPlayer,cfg=LEVELS[level]||LEVELS.normal;
  const possible=candidates(b,2),wins=immediateWins(b,aiPlayer,possible);
  if(wins.length)return {index:wins[0],reason:"直接成五",nodes:0,depth:0};
  const blocks=immediateWins(b,humanPlayer,possible);
  if(blocks.length===1)return {index:blocks[0],reason:"紧急堵五",nodes:0,depth:0};
  if(blocks.length>1){
    let best=possible[0]??-1,bestThreats=Infinity,bestScore=-Infinity;
    for(const i of possible){if(b[i])continue;const score=pointValue(b,i,aiPlayer);b[i]=aiPlayer;const enemyThreats=immediateWins(b,humanPlayer).length;b[i]=0;if(enemyThreats<bestThreats||(enemyThreats===bestThreats&&score>bestScore)){best=i;bestThreats=enemyThreats;bestScore=score;}}
    return {index:best,reason:"多重威胁下的最佳防守",nodes:0,depth:0};
  }
  const width=Number.isFinite(options.width)?Math.max(1,options.width):cfg.width;
  const rootMoves=orderedSearchMoves(b,aiPlayer,width,-1,possible);
  if(!rootMoves.length)return {index:-1,reason:"无合法落点",nodes:0,depth:0};
  const timeMs=Number.isFinite(options.timeMs)?Math.max(0,options.timeMs):cfg.timeMs;
  if(!cfg.depth||timeMs===0)return {index:rootMoves[0],reason:level==="easy"?"棋形判断":"有限时间搜索",nodes:0,depth:0};
  const maxDepth=Number.isFinite(options.maxDepth)?Math.max(1,options.maxDepth):cfg.maxDepth;
  const deadline=Date.now()+timeMs,tt=new Map(),initialHash=hashBoard(b);
  let nodes=0,bestMove=rootMoves[0],completedDepth=0,bestValue=-Infinity;
  function search(p,depth,alpha,beta,ply,hashLo,hashHi,qLeft=2){
    nodes++;if((nodes&31)===0&&Date.now()>=deadline)throw SEARCH_TIMEOUT;
    const movesNear=candidates(b,2),ownWins=immediateWins(b,p,movesNear);
    if(ownWins.length)return MATE_SCORE-ply;
    const enemyWins=immediateWins(b,3-p,movesNear);
    if(enemyWins.length>=2)return -MATE_SCORE+ply+1;
    if(depth<=0){
      if(enemyWins.length===1&&qLeft>0){const i=enemyWins[0],key=i*3+p;b[i]=p;try{return -search(3-p,0,-beta,-alpha,ply+1,(hashLo^ZOBRIST_LO[key])>>>0,(hashHi^ZOBRIST_HI[key])>>>0,qLeft-1);}finally{b[i]=0;}}
      return estimate(b,p);
    }
    const key=hashLo.toString(16)+":"+hashHi.toString(16)+":"+p,alphaOriginal=alpha,betaOriginal=beta,cached=tt.get(key);
    if(cached&&cached.depth>=depth){if(cached.flag===0)return cached.value;if(cached.flag===1)alpha=Math.max(alpha,cached.value);else beta=Math.min(beta,cached.value);if(alpha>=beta)return cached.value;}
    const moves=enemyWins.length===1?enemyWins:orderedSearchMoves(b,p,depth>=5?10:8,cached?cached.bestMove:-1,movesNear);
    if(!moves.length)return 0;
    let best=-Infinity,bestMoveHere=moves[0];
    for(const i of moves){if(b[i])continue;b[i]=p;const zobristKey=i*3+p;let value;try{value=winLine(b,i,p).length?MATE_SCORE-ply:-search(3-p,depth-1,-beta,-alpha,ply+1,(hashLo^ZOBRIST_LO[zobristKey])>>>0,(hashHi^ZOBRIST_HI[zobristKey])>>>0,qLeft);}finally{b[i]=0;}if(value>best){best=value;bestMoveHere=i;}alpha=Math.max(alpha,best);if(alpha>=beta)break;}
    if(best===-Infinity)return estimate(b,p);
    const flag=best<=alphaOriginal?2:best>=betaOriginal?1:0;tt.set(key,{depth,value:best,flag,bestMove:bestMoveHere});if(tt.size>75000)tt.clear();return best;
  }
  for(let depth=1;depth<=maxDepth;depth++){
    if(Date.now()>=deadline)break;
    const order=[bestMove,...rootMoves.filter(i=>i!==bestMove)];let iterationBest=bestMove,iterationValue=-Infinity,alpha=-Infinity,complete=true;
    try{for(const i of order){if(Date.now()>=deadline)throw SEARCH_TIMEOUT;b[i]=aiPlayer;const zobristKey=i*3+aiPlayer;let value;try{value=winLine(b,i,aiPlayer).length?MATE_SCORE:-search(humanPlayer,depth-1,-Infinity,-alpha,1,(initialHash[0]^ZOBRIST_LO[zobristKey])>>>0,(initialHash[1]^ZOBRIST_HI[zobristKey])>>>0,2);}finally{b[i]=0;}if(value>iterationValue){iterationValue=value;iterationBest=i;}alpha=Math.max(alpha,iterationValue);}}
    catch(error){if(error!==SEARCH_TIMEOUT)throw error;complete=false;}
    if(!complete)break;bestMove=iterationBest;bestValue=iterationValue;completedDepth=depth;if(Math.abs(bestValue)>=MATE_SCORE-100)break;
  }
  return {index:bestMove,reason:"王者模式 · 迭代加深 α-β + 置换表 + 战术延伸（深度 "+completedDepth+"）",nodes,depth:completedDepth,elapsedMs:timeMs-Math.max(0,deadline-Date.now())};
}
export function advice(b,p,played,level="hard"){
  const options=rankedMoves(b,p,5);
  const immediate=immediateWins(b,p);
  const enemy=immediateWins(b,3-p);
  let category="合理";
  if(immediate.length)category=immediate.includes(played)?"抓住必胜点":"漏杀：有直接成五点";
  else if(enemy.length)category=enemy.includes(played)?"及时防住对方成五":"漏防：对手下一手可成五";
  else{
    const shape=pointShape(b,played,p);
    if(shape.kind!=="普通")category=shape.kind;
    else if(!options.includes(played))category="非优先候选（启发式）";
  }
  return {category,best:options[0]??null,alternatives:options.slice(0,3),rank:options.indexOf(played)+1};
}
export function replay(moves){
  const b=Array(CELLS).fill(0),frames=[b.slice()];
  for(const m of moves){
    if(!Number.isInteger(m.i)||m.i<0||m.i>=CELLS||b[m.i]||![1,2].includes(m.p))throw Error("Invalid move sequence");
    b[m.i]=m.p;
    frames.push(b.slice());
  }
  return frames;
}
