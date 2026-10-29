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
  const puzzle={size,connect,board,solutionIndex:target,solutionSequence:[target,blockIndex,finishIndex],difficulty,reward:level.reward,objective:level.objective};
  if(!validatePuzzleSolution(puzzle)) return null;
  return puzzle;
}
export function validatePuzzleSolution(puzzle) {
  if (!puzzle || !Array.isArray(puzzle.board)) return false;
  const {board,size,connect,solutionIndex,solutionSequence,difficulty}=puzzle;
  if (!Number.isInteger(size) || !Number.isInteger(connect) || board.length!==size*size ||
      !Array.isArray(solutionSequence) || solutionSequence.length!==3 ||
      new Set(solutionSequence).size!==3) return false;
  if (boardHasWinner(board,size,connect) ||
      modeWinningMoves(board,1,size,connect).length ||
      modeWinningMoves(board,2,size,connect).length) return false;
  if (findPuzzleSolution(board,difficulty,size,connect)!==solutionIndex ||
      solutionSequence[0]!==solutionIndex) return false;
  const next=board.slice();
  const [first,block,finish]=solutionSequence;
  if (solutionSequence.some(i=>!Number.isInteger(i)||i<0||i>=next.length||next[i])) return false;
  next[first]=1;
  const winningEndpoints=modeWinningMoves(next,1,size,connect);
  if (winningEndpoints.length!==2 || !winningEndpoints.includes(block) || !winningEndpoints.includes(finish)) return false;
  next[block]=2;
  next[finish]=1;
  return modeWinLine(next,finish,1,size,connect).length>=connect;
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
export function randomAIStrategy(connect) {
  if (!Number.isInteger(connect) || connect < 3 || connect > 10) throw new RangeError("连珠数必须为 3–10");
  // Shorter games have denser tactical threats and can afford deeper search;
  // longer games have much larger boards, so use a wider positional horizon.
  if (connect <= 4) return { depth: 3, width: 12, replyWidth: 8, nodeLimit: 180 };
  if (connect <= 6) return { depth: 2, width: 14, replyWidth: 8, nodeLimit: 220 };
  if (connect <= 8) return { depth: 2, width: 12, replyWidth: 7, nodeLimit: 180 };
  return { depth: 2, width: 10, replyWidth: 6, nodeLimit: 140 };
}

function tacticalValue(board, player, size, connect) {
  const ownWins = modeWinningMoves(board, player, size, connect);
  if (ownWins.length) return 1e12 + ownWins.length * 1e8;
  const enemyWins = modeWinningMoves(board, 3-player, size, connect);
  if (enemyWins.length) return -1e12 - enemyWins.length * 1e8;
  return evaluatePosition(board, player, size, connect);
}

export function chooseRandomMove(board,size,connect,player=2) {
  if (!Array.isArray(board) || board.length !== size*size ||
      !Number.isInteger(size) || connect < 3 || connect > 10 || size < 2*connect+3 ||
      ![1,2].includes(player)) return -1;
  if (!board.some(v => v === 0)) return -1;

  // Always resolve immediate wins/losses before positional evaluation.
  const ownWins = modeWinningMoves(board, player, size, connect);
  if (ownWins.length) return ownWins[0];
  const opponent = 3-player;
  const enemyWins = modeWinningMoves(board, opponent, size, connect);
  if (enemyWins.length === 1) return enemyWins[0];

  const profile = randomAIStrategy(connect);
  const candidates = rankedCandidates(board, size, connect, player, profile.width);
  let bestMove = candidates[0] ?? board.findIndex(v => v === 0);
  let bestValue = -Infinity;
  let visited = 0;

  // Negamax-style alpha-beta with connect-dependent depth/width. Every branch
  // checks immediate wins and forced blocks, so the AI cannot blindly extend
  // its own line while ignoring a one-move loss.
  function search(depth, toMove, alpha, beta, lastMove) {
    if (lastMove >= 0 && modeWinLine(board, lastMove, 3-toMove, size, connect).length) {
      return (3-toMove === player ? 1 : -1) * (1e11 + depth);
    }
    if (depth === 0 || visited >= profile.nodeLimit) {
      return tacticalValue(board, player, size, connect);
    }
    const wins = modeWinningMoves(board, toMove, size, connect);
    if (wins.length) return toMove === player ? 1e12 + wins.length : -1e12 - wins.length;
    const moves = rankedCandidates(board, size, connect, toMove,
      depth === profile.depth ? profile.width : profile.replyWidth);
    if (!moves.length) return tacticalValue(board, player, size, connect);
    const maximizing = toMove === player;
    let value = maximizing ? -Infinity : Infinity;
    for (const move of moves) {
      if (board[move]) continue;
      board[move] = toMove;
      visited++;
      const next = search(depth-1, 3-toMove, alpha, beta, move);
      board[move] = 0;
      if (maximizing) {
        value = Math.max(value, next);
        alpha = Math.max(alpha, value);
      } else {
        value = Math.min(value, next);
        beta = Math.min(beta, value);
      }
      if (alpha >= beta || visited >= profile.nodeLimit) break;
    }
    return value === Infinity || value === -Infinity
      ? tacticalValue(board, player, size, connect) : value;
  }

  for (const move of candidates) {
    if (board[move]) continue;
    board[move] = player;
    visited++;
    const value = modeWinLine(board, move, player, size, connect).length
      ? 1e12
      : search(profile.depth-1, opponent, -Infinity, Infinity, move);
    board[move] = 0;
    if (value > bestValue) {
      bestValue = value;
      bestMove = move;
    }
    // Keep evaluating every root candidate. Once the node budget is exhausted,
    // deeper calls fall back to static/tactical evaluation instead of biasing
    // the decision toward whichever root move happened to be searched first.
  }

  // If all candidate lines lose tactically, prioritize the move that leaves
  // the fewest immediate enemy winning points, then use positional evaluation.
  if (bestValue <= -1e11) {
    let leastBad = Infinity;
    for (const move of rankedCandidates(board, size, connect, player, Math.min(24, board.length))) {
      board[move] = player;
      const threats = modeWinningMoves(board, opponent, size, connect).length;
      const score = evaluatePosition(board, player, size, connect);
      board[move] = 0;
      const value = threats * 1e12 - score;
      if (value < leastBad) { leastBad = value; bestMove = move; }
    }
  }
  return Number.isInteger(bestMove) && bestMove >= 0 && !board[bestMove]
    ? bestMove : board.findIndex(v => v === 0);
}
