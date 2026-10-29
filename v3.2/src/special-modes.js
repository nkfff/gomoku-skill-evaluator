// Shared deterministic puzzle generator and variable-connect Gomoku engine.
// Pure module: safe to import from both the browser and Cloudflare Worker.
export const PUZZLE_LEVELS = {
  easy: {label:"初级", reward:10, threats:2, clutter:6, objective:"找到唯一的起手点，挡住一路后沿另一条线路完成连珠"},
  normal: {label:"进阶", reward:30, threats:2, clutter:10, objective:"识别双路威胁，完成至少两手的强制组合"},
  hard: {label:"大师", reward:80, threats:2, clutter:14, objective:"在更多干扰棋子中找到唯一的强制组合"}
};
const DIRS = [[0,1],[1,0],[1,1],[1,-1]];
const inside = (r,c,size) => r >= 0 && r < size && c >= 0 && c < size;
const spot = (r,c,size) => r * size + c;
function seeded(seed) {
  let x = (Number(seed) >>> 0) || 0x6d2b79f5;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
function shuffle(items, random) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export function modeWinLine(board, index, player, size, connect) {
  if (!Array.isArray(board) || board.length !== size * size || !Number.isInteger(index) || index < 0 || index >= board.length) return [];
  const row = Math.floor(index / size), col = index % size;
  for (const [dr,dc] of DIRS) {
    const cells = [index];
    for (const sign of [-1,1]) {
      let r = row + dr * sign, c = col + dc * sign;
      while (inside(r,c,size) && board[spot(r,c,size)] === player) {
        cells.push(spot(r,c,size)); r += dr * sign; c += dc * sign;
      }
    }
    if (cells.length >= connect) return cells;
  }
  return [];
}
export function modeWinningMoves(board, player, size=15, connect=5) {
  const wins = [];
  for (let i=0;i<board.length;i++) {
    if (board[i]) continue;
    board[i] = player;
    const won = modeWinLine(board,i,player,size,connect).length > 0;
    board[i] = 0;
    if (won) wins.push(i);
  }
  return wins;
}
function forkThreatCount(board, index, player, size, connect) {
  if (board[index]) return 0;
  board[index] = player;
  if (modeWinLine(board,index,player,size,connect).length) {
    board[index] = 0;
    return 99;
  }
  // Count actual immediate winning cells after this candidate move, rather
  // than estimating from contiguous runs; this is robust for every connect N.
  const threats = modeWinningMoves(board,player,size,connect).length;
  board[index] = 0;
  return threats;
}
export function findPuzzleSolution(board, difficulty="easy", size=15, connect=5) {
  const level=PUZZLE_LEVELS[difficulty];
  if (!level || !Array.isArray(board) || board.length !== size*size) return null;
  const candidates=[];
  for(let i=0;i<board.length;i++) {
    if(board[i]) continue;
    board[i]=1;
    const direct=modeWinLine(board,i,1,size,connect).length>0;
    const continuations=direct?[]:modeWinningMoves(board,1,size,connect);
    board[i]=0;
    if(!direct && continuations.length>=2) {
      candidates.push(i);
      if(candidates.length>1)return null;
    }
  }
  return candidates.length===1?candidates[0]:null;
}
function boardHasWinner(board,size,connect) {
  for(let i=0;i<board.length;i++) if(board[i] && modeWinLine(board,i,board[i],size,connect).length) return true;
  return false;
}
function puzzleAttempt(difficulty, random, addClutter) {
  const size=15,connect=5,level=PUZZLE_LEVELS[difficulty];
  const targetRow=5+Math.floor(random()*5),targetCol=5+Math.floor(random()*5);
  const target=spot(targetRow,targetCol,size);
  const directions=[[0,1],[1,0]]; // perpendicular threats give a verifiable forced fork
  const board=Array(size*size).fill(0);
  for(const [dr,dc] of directions) {
    board[spot(targetRow-dr*2,targetCol-dc*2,size)]=1;
    board[spot(targetRow-dr,targetCol-dc,size)]=1;
    board[spot(targetRow+dr,targetCol+dc,size)]=1;
    board[spot(targetRow+dr*2,targetCol+dc*2,size)]=2;
  }
  if(addClutter) {
    const fillerCount=level.clutter;
    let placed=0,attempts=0;
    while(placed<fillerCount && attempts<160) {
      attempts++;
      const i=Math.floor(random()*board.length);
      if(board[i]) continue;
      const r=Math.floor(i/size),c=i%size;
      if(Math.max(Math.abs(r-targetRow),Math.abs(c-targetCol))<=4) continue;
      const player=random()<0.53?1:2;
      board[i]=player;
      if(modeWinLine(board,i,player,size,connect).length) {board[i]=0;continue;}
      placed++;
    }
    if(placed!==fillerCount) return null;
  }
  if(boardHasWinner(board,size,connect)) return null;
  const blackWins=modeWinningMoves(board,1,size,connect);
  const whiteWins=modeWinningMoves(board,2,size,connect);
  if(whiteWins.length) return null;
  if(blackWins.length) return null;
  const solution=findPuzzleSolution(board,difficulty,size,connect);
  if(solution!==target || directions.length<2) return null;
  // The first move creates two independent winning endpoints. The opponent
  // blocks one, then the solver completes the other. The unique solution is
  // the opening move; the response/final move make the puzzle genuinely multi-step.
  const blockIndex=spot(targetRow-directions[0][0]*3,targetCol-directions[0][1]*3,size);
  const finishIndex=spot(targetRow-directions[1][0]*3,targetCol-directions[1][1]*3,size);
  if(board[blockIndex] || board[finishIndex] || blockIndex===finishIndex || blockIndex===target || finishIndex===target) return null;
  return {size,connect,board,solutionIndex:target,solutionSequence:[target,blockIndex,finishIndex],difficulty,reward:level.reward,objective:level.objective};
}
export function generatePuzzle(difficulty="easy", seed=Date.now()) {
  if(!PUZZLE_LEVELS[difficulty]) throw new Error("未知残局难度");
  const base=(Number(seed)>>>0)||0x6d2b79f5;
  for(let attempt=0;attempt<180;attempt++) {
    const random=seeded((base + Math.imul(attempt+1,0x9e3779b9))>>>0);
    const puzzle=puzzleAttempt(difficulty,random,true);
    if(puzzle) return {...puzzle,seed:base};
  }
  // Deterministic no-clutter fallback: the tactical construction itself remains solvable.
  for(let attempt=0;attempt<180;attempt++) {
    const random=seeded((base ^ Math.imul(attempt+17,0x85ebca6b))>>>0);
    const puzzle=puzzleAttempt(difficulty,random,false);
    if(puzzle) return {...puzzle,seed:base};
  }
  throw new Error("暂时无法生成符合校验条件的残局，请重新生成");
}
export function createRandomConfig(seed=Date.now()) {
  const random=seeded(seed);
  const connect=3+Math.floor(random()*8);
  const minSize=Math.max(11,2*connect+3);
  const maxSize=Math.min(29,minSize+4);
  const size=minSize+Math.floor(random()*(maxSize-minSize+1));
  return {size,connect,seed:(Number(seed)>>>0)||0x6d2b79f5};
}
export function randomCandidates(board,size,radius=2) {
  const out=new Set();
  for(let i=0;i<board.length;i++) if(board[i]) {
    const r=Math.floor(i/size),c=i%size;
    for(let dy=-radius;dy<=radius;dy++) for(let dx=-radius;dx<=radius;dx++) {
      const y=r+dy,x=c+dx;
      if(inside(y,x,size)) {const j=spot(y,x,size);if(!board[j])out.add(j);}
    }
  }
  if(out.size) return [...out];
  return [spot(Math.floor(size/2),Math.floor(size/2),size)];
}
function runScore(run, openEnds, connect) {
  if(run>=connect) return 1e12;
  if(run<=0 || openEnds<=0) return 0;
  const progress=run/connect;
  const scale=Math.pow(7,run);
  const urgency=run>=connect-2?12:run>=connect-3?4:1;
  return scale*urgency*(openEnds===2?2.2:1);
}
function evaluatePlayer(board,player,size,connect) {
  let total=0;
  for(const [dr,dc] of DIRS) {
    for(let r=0;r<size;r++) for(let c=0;c<size;c++) {
      if(board[spot(r,c,size)]!==player) continue;
      const pr=r-dr,pc=c-dc;
      if(inside(pr,pc,size)&&board[spot(pr,pc,size)]===player) continue;
      let length=0,rr=r,cc=c;
      while(inside(rr,cc,size)&&board[spot(rr,cc,size)]===player){length++;rr+=dr;cc+=dc;}
      const beforeR=r-dr,beforeC=c-dc;
      const openBefore=inside(beforeR,beforeC,size)&&board[spot(beforeR,beforeC,size)]===0;
      const openAfter=inside(rr,cc,size)&&board[spot(rr,cc,size)]===0;
      total+=runScore(length,Number(openBefore)+Number(openAfter),connect);
      // Reward useful broken-three/four patterns with a single gap.
      const gapR=r+dr*(length+1),gapC=c+dc*(length+1);
      if(inside(gapR,gapC,size)&&board[spot(gapR,gapC,size)]===player){
        let tail=0,tr=gapR,tc=gapC;
        while(inside(tr,tc,size)&&board[spot(tr,tc,size)]===player){tail++;tr+=dr;tc+=dc;}
        if(length+tail<connect) {
          const left=inside(r-dr,c-dc,size)&&board[spot(r-dr,c-dc,size)]===0;
          const right=inside(tr,tc,size)&&board[spot(tr,tc,size)]===0;
          total+=runScore(length+tail,Number(left)+Number(right),connect)*0.42;
        }
      }
    }
  }
  return total;
}
function evaluatePosition(board,player,size,connect) {
  const own=evaluatePlayer(board,player,size,connect);
  const opp=evaluatePlayer(board,3-player,size,connect);
  return own-opp*1.12;
}
function staticMoveScore(board,index,player,size,connect) {
  board[index]=player;
  if(modeWinLine(board,index,player,size,connect).length){board[index]=0;return 1e15;}
  const score=evaluatePosition(board,player,size,connect);
  board[index]=0;
  return score;
}
function rankedCandidates(board,size,connect,player,limit=16) {
  return randomCandidates(board,size,2)
    .map(index=>({index,score:staticMoveScore(board,index,player,size,connect)}))
    .sort((a,b)=>b.score-a.score)
    .slice(0,limit)
    .map(x=>x.index);
}
export function chooseRandomMove(board,size,connect,player=2) {
  if(!Array.isArray(board)||board.length!==size*size||connect<3||connect>10||size<connect) return -1;
  const empty=board.reduce((n,v)=>n+(v===0),0);
  if(!empty)return -1;
  // Tactical layer 1: take a win immediately.
  const ownWins=modeWinningMoves(board,player,size,connect);
  if(ownWins.length)return ownWins[0];
  // Tactical layer 2: block an immediate loss, choosing the least damaging
  // block if the opponent has created multiple simultaneous winning points.
  const oppWins=modeWinningMoves(board,3-player,size,connect);
  if(oppWins.length===1)return oppWins[0];
  if(oppWins.length>1) {
    const blocks=rankedCandidates(board,size,connect,player,Math.min(24,empty));
    let best=blocks[0],bestThreats=Infinity,bestScore=-Infinity;
    for(const i of blocks){
      board[i]=player;
      const remaining=modeWinningMoves(board,3-player,size,connect).length;
      const score=evaluatePosition(board,player,size,connect);
      board[i]=0;
      if(remaining<bestThreats||(remaining===bestThreats&&score>bestScore)){best=i;bestThreats=remaining;bestScore=score;}
    }
    return best;
  }
  // Tactical layer 3: consider both attack and defence at every candidate.
  // A short minimax look-ahead stops the old "keep extending my own line"
  // behavior and adapts evaluation to the actual connect length.
  const candidates=rankedCandidates(board,size,connect,player,14);
  let best=candidates[0]??Math.floor(size/2)*size+Math.floor(size/2);
  let bestScore=-Infinity;
  for(const move of candidates){
    board[move]=player;
    if(modeWinLine(board,move,player,size,connect).length){board[move]=0;return move;}
    const opponentWins=modeWinningMoves(board,3-player,size,connect);
    if(opponentWins.length){board[move]=0;continue;}
    const replies=rankedCandidates(board,size,connect,3-player,8);
    let worst=Infinity;
    for(const reply of replies){
      board[reply]=3-player;
      const replyWins=modeWinLine(board,reply,3-player,size,connect).length>0;
      const score=replyWins?-1e13:evaluatePosition(board,player,size,connect);
      board[reply]=0;
      if(score<worst)worst=score;
      if(worst<bestScore)break;
    }
    board[move]=0;
    const center=(size-1)/2,row=Math.floor(move/size),col=move%size;
    const score=(worst===Infinity?evaluatePosition(board,player,size,connect):worst)
      - (Math.abs(row-center)+Math.abs(col-center))*0.05;
    if(score>bestScore){bestScore=score;best=move;}
  }
  if(bestScore===-Infinity){
    const fallback=rankedCandidates(board,size,connect,player,1)[0];
    return fallback??board.findIndex(v=>v===0);
  }
  return best;
}
