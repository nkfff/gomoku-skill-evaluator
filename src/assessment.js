// Bounded depth-2 counterfactual evaluation.
// All numbers are heuristic advantage indices, not calibrated win rates or Elo.
import {CELLS,candidates,immediateWins,pointShape,rankedMoves,winLine} from "./engine.js";

export const ANALYSIS_VERSION = "v2-depth2-1";
const MATE = 100;
const CANDIDATE_LIMIT = 9;
const RESPONSE_LIMIT = 6;
const clamp = (v,min,max)=>Math.min(max,Math.max(min,v));

function estimatePosition(board,player){
  const options=candidates(board);
  let own=0,opp=0,ownSecond=0,oppSecond=0;
  for(const i of options){
    const a=pointShape(board,i,player).score;
    const z=pointShape(board,i,3-player).score;
    if(a>own){ownSecond=own;own=a;}else if(a>ownSecond)ownSecond=a;
    if(z>opp){oppSecond=opp;opp=z;}else if(z>oppSecond)oppSecond=z;
  }
  const raw=own+ownSecond*.16-opp*1.1-oppSecond*.15;
  // Roughly scale large signature values into a readable, finite advantage index.
  const signed=Math.sign(raw)*Math.log1p(Math.abs(raw)/200);
  return clamp(100*signed/Math.log1p(100000000/200),-95,95);
}
function candidateScore(board,player,i){
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
    else value=estimatePosition(board,player);
    board[j]=0;
    worst=Math.min(worst,value);
    if(worst<=-MATE)break;
  }
  board[i]=0;
  return Number.isFinite(worst)?worst:estimatePosition(board,player);
}
/**
 * Rank a bounded selection of candidate moves, including the actual played move.
 * Depth = own move + strongest one-ply opponent response.
 * "loss" is a 0-200 difference in heuristic advantage units, NOT centipawns.
 */
export function analyzeMove(board,player,played){
  if(![1,2].includes(player)||!Number.isInteger(played)||played<0||played>=CELLS||board.length!==CELLS||board[played])throw Error("Invalid analysis position/move");
  const b=board.slice();
  const ownWins=immediateWins(b,player);
  const enemyWins=immediateWins(b,3-player);
  const prioritized=rankedMoves(b,player,CANDIDATE_LIMIT);
  const selected=[...new Set([...prioritized,played])];
  // When the player must block more than one direct threat there may be no save.
  const scored=selected.map(i=>({index:i,value:candidateScore(b,player,i)}));
  scored.sort((a,z)=>z.value-a.value||a.index-z.index);
  const bestValue=scored[0].value,actual=scored.find(x=>x.index===played);
  const loss=Math.max(0,Number((bestValue-actual.value).toFixed(2)));
  const tiedBest=scored.filter(x=>Math.abs(x.value-bestValue)<.5).map(x=>x.index);
  const top3=scored.slice(0,3).map(x=>x.index);
  const isTop1=tiedBest.includes(played);
  const isTop3=top3.includes(played)||isTop1;
  let category="合理";
  let severe=false;
  if(ownWins.length){
    if(ownWins.includes(played))category="抓住直接胜点";
    else {category="漏杀：放弃直接成五";severe=true;}
  }else if(enemyWins.length){
    if(enemyWins.includes(played))category="直接胜点防守";
    else {category="漏防：对手可直接成五";severe=true;}
  }else if(loss>=55){category="严重失误（搜索估计）";severe=true;}
  else if(loss>=25)category="明显偏差（搜索估计）";
  else if(loss>=8)category="小幅偏差";
  else if(isTop1)category="搜索首选";
  else category="合理候选";
  // Forced tactical misses are severe even if all replies eventually lose.
  const accuracy=clamp(Math.round(100-1.2*loss),0,100);
  return {
    version:ANALYSIS_VERSION,depth:2,candidateCount:scored.length,
    best:scored[0].index,alternatives:scored.slice(0,3).map(x=>x.index),
    top1:isTop1,top3:isTop3,
    rank:scored.findIndex(x=>x.index===played)+1,
    bestValue:+bestValue.toFixed(2),playedValue:+actual.value.toFixed(2),
    loss,accuracy,severe,category
  };
}
export function summarizeQuality(moves){
  const human=moves.filter(m=>m.p===1);
  const assessed=human.filter(m=>m.quality?.version===ANALYSIS_VERSION);
  const n=assessed.length;
  if(!n)return {ready:0,total:human.length,score:null,top1:0,top3:0,severe:0,severeRate:0,accuracy:null,avgTime:null};
  const first=assessed.filter(m=>m.quality.top1).length;
  const top=assessed.filter(m=>m.quality.top3).length;
  const errors=assessed.filter(m=>m.quality.severe).length;
  const avgAccuracy=assessed.reduce((sum,m)=>sum+m.quality.accuracy,0)/n;
  const score=clamp(Math.round(.55*avgAccuracy+20*first/n+10*top/n+15*(1-errors/n)),0,100);
  return {ready:n,total:human.length,score,top1:first/n,top3:top/n,severe:errors,severeRate:errors/n,
    accuracy:+avgAccuracy.toFixed(1),avgTime:+(assessed.reduce((s,m)=>s+m.seconds,0)/n).toFixed(1)};
}
