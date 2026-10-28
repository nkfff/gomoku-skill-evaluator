// V2.1 — opportunity-normalized, complexity-aware game-quality estimation.
// Bounded heuristic search, NOT a professional Gomoku solver or calibrated rating.
import {CELLS,candidates,immediateWins,pointShape,rankedMoves,winLine} from "./engine.js";

export const ANALYSIS_VERSION = "v2.1-depth2";
const MATE=100, CANDIDATE_LIMIT=9, RESPONSE_LIMIT=6;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const round=(x,d=1)=>Number(x.toFixed(d));

function positionValue(board,player){
  const places=candidates(board);
  let a=0,a2=0,z=0,z2=0;
  for(const i of places){
    const own=pointShape(board,i,player).score;
    const opp=pointShape(board,i,3-player).score;
    if(own>a){a2=a;a=own;}else if(own>a2)a2=own;
    if(opp>z){z2=z;z=opp;}else if(opp>z2)z2=opp;
  }
  const raw=a+.16*a2-1.1*z-.15*z2;
  return clamp(100*Math.sign(raw)*Math.log1p(Math.abs(raw)/200)/Math.log1p(100000000/200),-95,95);
}
function candidateValue(board,player,i){
  const opponent=3-player;
  board[i]=player;
  if(winLine(board,i,player).length){board[i]=0;return MATE;}
  if(immediateWins(board,opponent).length){board[i]=0;return -MATE;}
  const replies=rankedMoves(board,opponent,RESPONSE_LIMIT);
  let worst=Infinity;
  for(const j of replies){
    board[j]=opponent;
    let value;
    if(winLine(board,j,opponent).length)value=-MATE;
    else if(immediateWins(board,player).length)value=98;
    else value=positionValue(board,player);
    board[j]=0;
    worst=Math.min(worst,value);
    if(worst<=-MATE)break;
  }
  board[i]=0;
  return Number.isFinite(worst)?worst:positionValue(board,player);
}
function canStopDirectWin(board,player){
  const b=board.slice(),enemy=3-player;
  const saves=[];
  for(const i of candidates(b)){
    b[i]=player;
    if(immediateWins(b,enemy).length===0)saves.push(i);
    b[i]=0;
  }
  return saves;
}
export function analyzeMove(board,player,played){
  if(board.length!==CELLS||![1,2].includes(player)||
     !Number.isInteger(played)||played<0||played>=CELLS||board[played])
    throw Error("Invalid analysis position/move");
  const b=board.slice();
  const ownWins=immediateWins(b,player);
  const enemyWins=ownWins.length?[]:immediateWins(b,3-player);
  const defenses=enemyWins.length?canStopDirectWin(b,player):[];
  const unavoidable=enemyWins.length>0&&defenses.length===0;
  const opportunity=ownWins.length?"attack":defenses.length?"defense":null;
  const choices=[...new Set([...rankedMoves(b,player,CANDIDATE_LIMIT),played])];
  const scored=choices.map(i=>({index:i,value:candidateValue(b,player,i)}))
    .sort((a,z)=>z.value-a.value||a.index-z.index);
  const best=scored[0],actual=scored.find(x=>x.index===played);
  const loss=Math.max(0,round(best.value-actual.value,2));
  const top1=Math.abs(best.value-actual.value)<.5;
  const top3=top1||scored.slice(0,3).some(x=>x.index===played);
  let category="合理候选",severe=false,correct=null;
  if(unavoidable){category="不可避免的直接输棋（不纳入评分）";}
  else if(opportunity==="attack"){
    correct=ownWins.includes(played);
    if(correct)category="抓住直接胜点";
    else{category="漏杀：放弃直接成五";severe=true;}
  }else if(opportunity==="defense"){
    correct=defenses.includes(played);
    if(correct)category="成功化解直接成五威胁";
    else{category="漏防：仍允许对手直接成五";severe=true;}
  }else if(loss>=55){category="严重失误（搜索估计）";severe=true;}
  else if(loss>=25)category="明显偏差（搜索估计）";
  else if(loss>=8)category="小幅偏差";
  else if(top1)category="搜索首选";
  const spread=best.value-scored.at(-1).value;
  const complexity=opportunity?"关键战术":spread>=50?"高":spread>=15?"中":"低";
  const weight=opportunity?2.5:spread>=50?2:spread>=15?1.5:1;
  const evaluable=!unavoidable;
  const accuracy=evaluable?clamp(Math.round(100-1.2*loss),0,100):null;
  return {
    version:ANALYSIS_VERSION,depth:2,candidateCount:scored.length,
    best:best.index,alternatives:scored.slice(0,3).map(x=>x.index),
    top1,top3,rank:scored.findIndex(x=>x.index===played)+1,
    bestValue:round(best.value,2),playedValue:round(actual.value,2),
    loss,accuracy,severe,category,complexity,weight,
    opportunity,opportunityCorrect:correct,evaluable,
    searchSpread:round(spread,2)
  };
}
export function summarizeQuality(moves){
  const human=moves.filter(m=>m.p===1);
  const analyzed=human.filter(m=>m.quality?.version===ANALYSIS_VERSION);
  const eligible=analyzed.filter(m=>m.quality.evaluable!==false);
  const total=human.length,ready=analyzed.length,n=eligible.length;
  const empty={
    ready,total,scored:n,excluded:ready-n,score:null,top1:0,top3:0,
    severe:0,severeRate:0,accuracy:null,weightedAccuracy:null,avgTime:null,
    attackOpportunities:0,attackSuccess:0,defenseOpportunities:0,defenseSuccess:0,
    tacticalRate:null,tacticalOpportunities:0,complexityCounts:{low:0,medium:0,high:0,critical:0},
    effectiveSamples:0,confidence:"样本不足",confidenceNote:"没有可评分着法"
  };
  if(!n)return empty;
  let wsum=0,wsquares=0,weighted=0,top1=0,top3=0,severe=0;
  let attack=0,attackSuccess=0,defense=0,defenseSuccess=0;
  const complexityCounts={low:0,medium:0,high:0,critical:0};
  for(const m of eligible){
    const q=m.quality,w=q.weight??1;
    wsum+=w;wsquares+=w*w;weighted+=w*q.accuracy;
    if(q.top1)top1++;
    if(q.top3)top3++;
    if(q.severe)severe++;
    if(q.opportunity==="attack"){attack++;if(q.opportunityCorrect)attackSuccess++;}
    if(q.opportunity==="defense"){defense++;if(q.opportunityCorrect)defenseSuccess++;}
    if(q.complexity==="关键战术")complexityCounts.critical++;
    else if(q.complexity==="高")complexityCounts.high++;
    else if(q.complexity==="中")complexityCounts.medium++;
    else complexityCounts.low++;
  }
  const critical=attack+defense,success=attackSuccess+defenseSuccess;
  const tacticalRate=critical?success/critical:null;
  const weightedAccuracy=weighted/wsum;
  const severeRate=severe/n;
  const score=critical
    ? .75*weightedAccuracy+.15*100*tacticalRate+.10*100*(1-severeRate)
    : .90*weightedAccuracy+.10*100*(1-severeRate);
  const effective=wsum*wsum/wsquares;
  let confidence="样本不足";
  if(effective>=35&&critical>=5)confidence="相对较高";
  else if(effective>=20&&critical>=2)confidence="中等";
  else if(effective>=10)confidence="初步";
  const confidenceNote="有效样本约 "+round(effective)+" 手；关键攻防机会 "+critical+" 次。评估仍受有限搜索和对手水平限制。";
  return {
    ...empty,score:Math.round(clamp(score,0,100)),top1:top1/n,top3:top3/n,
    severe,severeRate,accuracy:round(eligible.reduce((a,m)=>a+m.quality.accuracy,0)/n),
    weightedAccuracy:round(weightedAccuracy),avgTime:round(eligible.reduce((a,m)=>a+m.seconds,0)/n),
    attackOpportunities:attack,attackSuccess,defenseOpportunities:defense,defenseSuccess,
    tacticalRate,tacticalOpportunities:critical,complexityCounts,
    effectiveSamples:round(effective),confidence,confidenceNote
  };
}
