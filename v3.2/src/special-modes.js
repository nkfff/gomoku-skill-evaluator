// Shared deterministic puzzle generator and variable-connect Gomoku engine.
// Pure module: safe to import from both the browser and Cloudflare Worker.
export const PUZZLE_LEVELS = {
  easy: {label:"初级", reward:10, steps:3, objective:"3 步强制杀：连续制造单点威胁，最后形成双杀"},
  normal: {label:"进阶", reward:30, steps:4, objective:"4 步强制杀：连续制造单点威胁，最后形成双杀"},
  hard: {label:"大师", reward:80, steps:5, objective:"5 步强制杀：连续制造单点威胁，最后形成双杀"}
};
const DIRS = [[0,1],[1,0],[1,1],[1,-1]];
const DIRS8 = [[0,1],[1,0],[1,1],[1,-1],[0,-1],[-1,0],[-1,-1],[-1,1]];
const inside = (r,c,size) => r >= 0 && r < size && c >= 0 && c < size;
const spot = (r,c,size) => r * size + c;
const add = (a,b,scale=1) => [a[0]+b[0]*scale,a[1]+b[1]*scale];
const sameLine = (a,b) => a[0]*b[1] === a[1]*b[0];
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

function winningMovesNear(board,player,lastMove,size,connect) {
  const wins=new Set(),row=Math.floor(lastMove/size),col=lastMove%size;
  for(const [dr,dc] of DIRS) for(let offset=-(connect-1);offset<=connect-1;offset++) {
    if(!offset)continue;
    const r=row+dr*offset,c=col+dc*offset;
    if(!inside(r,c,size))continue;
    const index=spot(r,c,size);
    if(board[index])continue;
    board[index]=player;
    const won=modeWinLine(board,index,player,size,connect).length>0;
    board[index]=0;
    if(won)wins.add(index);
  }
  return [...wins];
}
function boardHasWinner(board,size,connect) {
  for(let i=0;i<board.length;i++) if(board[i] && modeWinLine(board,i,board[i],size,connect).length) return true;
  return false;
}

function chooseDirection(random, excluded=[]) {
  const options=DIRS8.filter(d=>!excluded.some(e=>sameLine(d,e)));
  if(!options.length) return DIRS8[Math.floor(random()*DIRS8.length)];
  return options[Math.floor(random()*options.length)];
}

function buildPuzzlePattern(difficulty,random) {
  const level=PUZZLE_LEVELS[difficulty],size=21,connect=5,steps=level.steps;
  const cardinals=[[0,1],[1,0],[0,-1],[-1,0]];
  const lastStageDir=cardinals[Math.floor(random()*cardinals.length)];
  const perpendiculars=cardinals.filter(d=>d[0]*lastStageDir[0]+d[1]*lastStageDir[1]===0);
  const finalDir=perpendiculars[Math.floor(random()*perpendiculars.length)];
  const stageDirs=[];
  for(let i=0;i<steps-1;i++) {
    if(i===steps-2) stageDirs.push(lastStageDir);
    else stageDirs.push(chooseDirection(random,[lastStageDir,finalDir,...stageDirs.slice(-1)]));
  }
  const forkDir=[lastStageDir[0]+finalDir[0],lastStageDir[1]+finalDir[1]];
  const moves=[[0,0]];
  for(let i=1;i<steps-1;i++) moves.push(add(moves[i-1],stageDirs[i],3));
  moves.push(add(moves[moves.length-1],finalDir,3));
  const placements=[],place=(point,player)=>placements.push({point,player});
  for(let k=1;k<=3;k++) place(add(moves[0],stageDirs[0],-k),1);
  place(add(moves[0],stageDirs[0],-4),2);
  for(let i=1;i<steps-1;i++) {
    place(add(moves[i-1],stageDirs[i]),1);
    place(add(moves[i-1],stageDirs[i],2),1);
    place(add(moves[i-1],stageDirs[i],-1),2);
  }
  const finalMove=moves[steps-1];
  place(add(finalMove,finalDir,-1),1);
  place(add(finalMove,finalDir,-2),1);
  place(add(finalMove,finalDir,-4),2);
  place(add(finalMove,forkDir,-1),1);
  place(add(finalMove,forkDir,-2),1);
  place(add(finalMove,forkDir,-4),2);
  const responses=[];
  for(let i=0;i<steps-1;i++) responses.push(add(moves[i],stageDirs[i]));
  const finalWins=[add(finalMove,finalDir),add(finalMove,forkDir)];
  const allPoints=[...placements.map(x=>x.point),...moves,...responses,...finalWins];
  const minR=Math.min(...allPoints.map(p=>p[0])),maxR=Math.max(...allPoints.map(p=>p[0]));
  const minC=Math.min(...allPoints.map(p=>p[1])),maxC=Math.max(...allPoints.map(p=>p[1]));
  if(maxR-minR>=size||maxC-minC>=size) return null;
  const shiftR=-minR+Math.floor(random()*(size-(maxR-minR)));
  const shiftC=-minC+Math.floor(random()*(size-(maxC-minC)));
  const translate=p=>[p[0]+shiftR,p[1]+shiftC];
  const board=Array(size*size).fill(0);
  for(const {point,player} of placements) {
    const [r,c]=translate(point);
    if(!inside(r,c,size)) return null;
    const index=spot(r,c,size);
    if(board[index]&&board[index]!==player) return null;
    board[index]=player;
  }
  const moveIndices=moves.map(p=>{const [r,c]=translate(p);return inside(r,c,size)?spot(r,c,size):-1;});
  const responseIndices=responses.map(p=>{const [r,c]=translate(p);return inside(r,c,size)?spot(r,c,size):-1;});
  const finalWinIndices=finalWins.map(p=>{const [r,c]=translate(p);return inside(r,c,size)?spot(r,c,size):-1;});
  if([...moveIndices,...responseIndices,...finalWinIndices].some(i=>i<0)) return null;
  if([...moveIndices,...responseIndices,...finalWinIndices].some(i=>board[i])) return null;
  return {size,connect,board,moves:moveIndices,responses:responseIndices,finalWins:finalWinIndices,difficulty,reward:level.reward,objective:level.objective,steps};
}

function validatePuzzleLine(puzzle) {
  const {board:source,size,connect,moves,responses,finalWins}=puzzle;
  if(boardHasWinner(source,size,connect)) return false;
  if(modeWinningMoves(source,1,size,connect).length||modeWinningMoves(source,2,size,connect).length) return false;
  const board=source.slice();
  const futureMovesAreQuiet=fromIndex=>{
    for(let j=fromIndex+1;j<moves.length;j++) {
      const future=moves[j];
      if(board[future]) return false;
      board[future]=1;
      const direct=modeWinLine(board,future,1,size,connect).length>0;
      const threats=direct?[]:winningMovesNear(board,1,future,size,connect);
      board[future]=0;
      if(direct||threats.length) return false;
    }
    return true;
  };
  if(!futureMovesAreQuiet(0)) return false;
  for(let i=0;i<moves.length-1;i++) {
    const move=moves[i],response=responses[i];
    if(board[move]||board[response]) return false;
    board[move]=1;
    if(modeWinLine(board,move,1,size,connect).length) return false;
    const wins=winningMovesNear(board,1,move,size,connect);
    if(wins.length!==1||wins[0]!==response) return false;
    if(modeWinningMoves(board,2,size,connect).length) return false;
    board[response]=2;
    if(modeWinLine(board,response,2,size,connect).length) return false;
    if(winningMovesNear(board,2,response,size,connect).length) return false;
    if(modeWinningMoves(board,1,size,connect).length) return false;
  }
  const finalMove=moves[moves.length-1];
  if(board[finalMove]) return false;
  board[finalMove]=1;
  if(modeWinLine(board,finalMove,1,size,connect).length) return false;
  const wins=modeWinningMoves(board,1,size,connect);
  return wins.length===2&&finalWins.every(i=>wins.includes(i))&&modeWinningMoves(board,2,size,connect).length===0;
}

export function verifyPuzzleLine(puzzle) {
  return !!puzzle&&Array.isArray(puzzle.moves)&&Array.isArray(puzzle.responses)&&
    puzzle.moves.length===PUZZLE_LEVELS[puzzle.difficulty]?.steps&&validatePuzzleLine(puzzle);
}

export function generatePuzzle(difficulty="easy",seed=Date.now()) {
  const level=PUZZLE_LEVELS[difficulty];
  if(!level) throw new Error("未知残局难度");
  const base=(Number(seed)>>>0)||0x6d2b79f5;
  for(let attempt=0;attempt<240;attempt++) {
    const random=seeded((base+Math.imul(attempt+1,0x9e3779b9))>>>0);
    const puzzle=buildPuzzlePattern(difficulty,random);
    if(!puzzle||!verifyPuzzleLine(puzzle)) continue;
    return {...puzzle,solutionMoves:puzzle.moves.slice(),solutionResponses:puzzle.responses.slice(),seed:base};
  }
  throw new Error("暂时无法生成通过强制杀校验的多步残局，请重新生成");
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

function windowScore(count,connect,gapCount,openEnds) {
  if(!count) return 0;
  if(count>=connect) return 1e13;
  const remaining=connect-count;
  let score;
  if(remaining===1) score=2e9;
  else if(remaining===2) score=2e6;
  else if(remaining===3) score=2e3;
  else score=Math.pow(4.2,count)*(1+count/Math.max(1,connect-count));
  return score*Math.pow(0.58,gapCount)*(1+0.28*openEnds);
}

export function evaluateRandomBoard(board,size,connect,player=2) {
  const opponent=3-player;
  let ownScore=0,opponentScore=0;
  for(const [dr,dc] of DIRS) for(let r=0;r<size;r++) for(let c=0;c<size;c++) {
    const er=r+dr*(connect-1),ec=c+dc*(connect-1);
    if(!inside(er,ec,size)) continue;
    let own=0,other=0,first=connect,last=-1;
    for(let k=0;k<connect;k++) {
      const v=board[spot(r+dr*k,c+dc*k,size)];
      if(v===player){own++;first=Math.min(first,k);last=Math.max(last,k);}
      else if(v===opponent)other++;
    }
    if(own&&other) continue;
    if(!own&&!other) continue;
    let openEnds=0;
    const br=r-dr,bc=c-dc,ar=er+dr,ac=ec+dc;
    if(inside(br,bc,size)&&board[spot(br,bc,size)]===0)openEnds++;
    if(inside(ar,ac,size)&&board[spot(ar,ac,size)]===0)openEnds++;
    if(own)ownScore+=windowScore(own,connect,Math.max(0,last-first+1-own),openEnds);
    else opponentScore+=windowScore(other,connect,0,openEnds);
  }
  return ownScore-opponentScore*1.18;
}

function localMoveScore(board,index,size,connect,player) {
  const opponent=3-player,row=Math.floor(index/size),col=index%size;
  let score=0;
  for(const [dr,dc] of DIRS) for(let offset=0;offset<connect;offset++) {
    const sr=row-dr*offset,sc=col-dc*offset;
    const er=sr+dr*(connect-1),ec=sc+dc*(connect-1);
    if(!inside(sr,sc,size)||!inside(er,ec,size))continue;
    let own=0,other=0,ownFirst=connect,ownLast=-1,otherFirst=connect,otherLast=-1;
    for(let k=0;k<connect;k++) {
      const v=board[spot(sr+dr*k,sc+dc*k,size)];
      if(v===player){own++;ownFirst=Math.min(ownFirst,k);ownLast=Math.max(ownLast,k);}
      else if(v===opponent){other++;otherFirst=Math.min(otherFirst,k);otherLast=Math.max(otherLast,k);}
    }
    if(own&&other)continue;
    let openEnds=0;
    const br=sr-dr,bc=sc-dc,ar=er+dr,ac=ec+dc;
    if(inside(br,bc,size)&&board[spot(br,bc,size)]===0)openEnds++;
    if(inside(ar,ac,size)&&board[spot(ar,ac,size)]===0)openEnds++;
    if(other) score+=windowScore(other,connect,Math.max(0,otherLast-otherFirst+1-other),openEnds)*1.18;
    else {
      const before=windowScore(own,connect,Math.max(0,ownLast-ownFirst+1-own),openEnds);
      const afterCount=own+1,afterFirst=Math.min(ownFirst,offset),afterLast=Math.max(ownLast,offset);
      const after=windowScore(afterCount,connect,Math.max(0,afterLast-afterFirst+1-afterCount),openEnds);
      score+=after-before;
    }
  }
  const center=(size-1)/2;
  score+=Math.max(0,size-Math.abs(row-center)-Math.abs(col-center))*0.25;
  return score;
}

function rankMoves(board,size,connect,player,candidates,limit) {
  const ranked=[];
  for(const index of candidates) {
    if(board[index])continue;
    const localScore=localMoveScore(board,index,size,connect,player);
    board[index]=player;
    const win=modeWinLine(board,index,player,size,connect).length>0;
    board[index]=0;
    ranked.push({index,score:win?1e15:localScore});
  }
  ranked.sort((a,b)=>b.score-a.score);
  return ranked.slice(0,limit).map(x=>x.index);
}

export function chooseRandomMove(board,size,connect,player=2) {
  if(!Array.isArray(board)||board.length!==size*size||connect<3||connect>10)return -1;
  if(board.every(v=>v===0))return spot(Math.floor(size/2),Math.floor(size/2),size);
  const opponent=3-player;
  const wins=modeWinningMoves(board,player,size,connect);
  if(wins.length)return wins[0];
  const opponentWins=modeWinningMoves(board,opponent,size,connect);
  if(opponentWins.length===1)return opponentWins[0];
  const candidates=randomCandidates(board,size,Math.min(2,connect-1));
  const firstPly=rankMoves(board,size,connect,player,candidates,8);
  let bestMove=firstPly[0]??candidates[0],bestScore=-Infinity;
  for(const index of firstPly) {
    board[index]=player;
    if(modeWinLine(board,index,player,size,connect).length) {board[index]=0;return index;}
    const ownThreats=winningMovesNear(board,player,index,size,connect);
    let score;
    if(ownThreats.length>=2) score=8e12+evaluateRandomBoard(board,size,connect,player);
    else if(ownThreats.length===1) {
      const reply=ownThreats[0];
      board[reply]=opponent;
      score=modeWinLine(board,reply,opponent,size,connect).length
        ?-1e15:evaluateRandomBoard(board,size,connect,player)+1e5;
      board[reply]=0;
    } else {
      const replies=rankMoves(board,size,connect,opponent,randomCandidates(board,size,2),4);
      let worst=Infinity;
      for(const reply of replies) {
        board[reply]=opponent;
        let replyScore;
        if(modeWinLine(board,reply,opponent,size,connect).length)replyScore=-1e15;
        else {
          const enemyThreats=winningMovesNear(board,opponent,reply,size,connect);
          replyScore=evaluateRandomBoard(board,size,connect,player);
          if(enemyThreats.length>=2)replyScore-=8e12;
          else if(enemyThreats.length===1)replyScore-=1e8;
        }
        board[reply]=0;
        worst=Math.min(worst,replyScore);
      }
      score=Number.isFinite(worst)?worst:evaluateRandomBoard(board,size,connect,player);
    }
    board[index]=0;
    if(score>bestScore){bestScore=score;bestMove=index;}
  }
  return bestMove;
}

