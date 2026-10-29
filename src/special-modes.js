// Shared deterministic puzzle generator and variable-connect Gomoku engine.
// Pure module: safe to import from both the browser and Cloudflare Worker.
export const PUZZLE_LEVELS = {
  easy: {label:"初级", reward:10, threats:1, objective:"找到唯一的直接成五点"},
  normal: {label:"进阶", reward:30, threats:2, objective:"一手制造双路杀"},
  hard: {label:"大师", reward:80, threats:3, objective:"一手制造三路杀"}
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
  const row=Math.floor(index/size), col=index%size;
  let threats=0;
  for (const [dr,dc] of DIRS) {
    let count=1;
    for (const sign of [-1,1]) {
      let r=row+dr*sign,c=col+dc*sign;
      while (inside(r,c,size) && board[spot(r,c,size)]===player) {
        count++; r+=dr*sign; c+=dc*sign;
      }
    }
    if (count === connect-1) {
      let open=false;
      for (const sign of [-1,1]) {
        let r=row+dr*sign,c=col+dc*sign;
        while (inside(r,c,size) && board[spot(r,c,size)]===player) {
          r+=dr*sign; c+=dc*sign;
        }
        if (inside(r,c,size) && board[spot(r,c,size)]===0) open=true;
      }
      if (open) threats++;
    }
  }
  board[index]=0;
  return threats;
}
export function findPuzzleSolution(board, difficulty="easy", size=15, connect=5) {
  const level=PUZZLE_LEVELS[difficulty];
  if (!level || board.length !== size*size) return null;
  const direct=modeWinningMoves(board,1,size,connect);
  if (difficulty==="easy") return direct.length===1 ? direct[0] : null;
  if (direct.length) return null;
  const wins=[];
  for(let i=0;i<board.length;i++) {
    if(board[i]) continue;
    if(forkThreatCount(board,i,1,size,connect)>=level.threats) wins.push(i);
    if(wins.length>1) return null;
  }
  return wins.length===1 ? wins[0] : null;
}
function boardHasWinner(board,size,connect) {
  for(let i=0;i<board.length;i++) if(board[i] && modeWinLine(board,i,board[i],size,connect).length) return true;
  return false;
}
function puzzleAttempt(difficulty, random, addClutter) {
  const size=15,connect=5,level=PUZZLE_LEVELS[difficulty];
  const targetRow=5+Math.floor(random()*5),targetCol=5+Math.floor(random()*5);
  const target=spot(targetRow,targetCol,size);
  const directions=shuffle(DIRS,random).slice(0,level.threats);
  const board=Array(size*size).fill(0);
  for(const [dr,dc] of directions) {
    board[spot(targetRow-dr*2,targetCol-dc*2,size)]=1;
    board[spot(targetRow-dr,targetCol-dc,size)]=1;
    board[spot(targetRow+dr,targetCol+dc,size)]=1;
    board[spot(targetRow+dr*2,targetCol+dc*2,size)]=2;
  }
  if(addClutter) {
    const fillerCount=difficulty==="easy"?6:difficulty==="normal"?10:14;
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
  if(solution!==target) return null;
  return {size,connect,board,solutionIndex:target,difficulty,reward:level.reward,objective:level.objective};
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
function windowValue(count,connect) {
  if(count<=0) return 1;
  if(count>=connect) return 1e14;
  return Math.pow(5.5,count) * (count>=connect-2 ? 7 : count>=connect-3 ? 2.5 : 1);
}
function candidateValue(board,index,player,size,connect) {
  const opponent=3-player,row=Math.floor(index/size),col=index%size;
  board[index]=player;
  if(modeWinLine(board,index,player,size,connect).length) {board[index]=0;return 1e15;}
  let own=0,block=0;
  for(const [dr,dc] of DIRS) for(let offset=0;offset<connect;offset++) {
    const sr=row-dr*offset,sc=col-dc*offset,er=sr+dr*(connect-1),ec=sc+dc*(connect-1);
    if(!inside(sr,sc,size)||!inside(er,ec,size)) continue;
    let mine=0,theirs=0;
    for(let k=0;k<connect;k++) {
      const v=board[spot(sr+dr*k,sc+dc*k,size)];
      if(v===player)mine++;
      else if(v===opponent)theirs++;
    }
    if(!theirs) own=Math.max(own,windowValue(mine,connect));
    if(!mine) block=Math.max(block,windowValue(theirs,connect));
  }
  board[index]=0;
  const center=(size-1)/2;
  const centrality=Math.max(0,size-Math.abs(row-center)-Math.abs(col-center));
  return own+block*0.94+centrality*0.25;
}
export function chooseRandomMove(board,size,connect,player=2) {
  const possible=randomCandidates(board,size);
  const wins=[];
  for(const i of possible) {board[i]=player;const won=modeWinLine(board,i,player,size,connect).length>0;board[i]=0;if(won)wins.push(i);}
  if(wins.length)return wins[0];
  const blocks=[];
  for(const i of possible) {board[i]=3-player;const won=modeWinLine(board,i,3-player,size,connect).length>0;board[i]=0;if(won)blocks.push(i);}
  if(blocks.length)return blocks[0];
  let best=possible[0],bestScore=-Infinity;
  for(const i of possible) {
    const score=candidateValue(board,i,player,size,connect);
    if(score>bestScore){bestScore=score;best=i;}
  }
  return best;
}
