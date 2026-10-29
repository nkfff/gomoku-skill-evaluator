// Shared deterministic puzzle generator and variable-connect Gomoku engine.
// Pure module: safe to import from both the browser and Cloudflare Worker.
export const PUZZLE_LEVELS = {
  easy: {label:"初级", reward:10, threats:2, objective:"找到唯一的起手，防守后完成制胜点"},
  normal: {label:"进阶", reward:30, threats:2, objective:"识别双威胁并完成连续杀棋"},
  hard: {label:"大师", reward:80, threats:2, objective:"在复杂干扰下完成唯一强制杀棋"}
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
  if(!level || board.length!==size*size) return null;
  if(modeWinningMoves(board,1,size,connect).length) return null;
  const wins=[];
  for(let i=0;i<board.length;i++){
    if(board[i])continue;
    if(forkThreatCount(board,i,1,size,connect)>=level.threats)wins.push(i);
    if(wins.length>1)return null;
  }
  return wins.length===1?wins[0]:null;
}
export function findPuzzleLine(board,difficulty="easy",size=15,connect=5){
  const first=findPuzzleSolution(board,difficulty,size,connect);
  if(first===null)return null;
  const state=board.slice();state[first]=1;
  const threats=modeWinningMoves(state,1,size,connect);
  if(threats.length<2)return null;
  const defense=threats[0];state[defense]=2;
  const finalMoves=modeWinningMoves(state,1,size,connect);
  if(finalMoves.length!==1)return null;
  return [first,defense,finalMoves[0]];
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
  const solutionSequence=findPuzzleLine(board,difficulty,size,connect);
  if(solution!==target || !solutionSequence || solutionSequence[0]!==target) return null;
  return {size,connect,board,solutionIndex:target,solutionSequence,difficulty,reward:level.reward,objective:level.objective};
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
  if(count>=connect) return 1e12;
  const remaining=connect-count;
  const base=connect<=4?12:connect<=6?7:4.2;
  return Math.pow(base,count) * (remaining===1?30:remaining===2?7:remaining===3?2:1);
}
function candidateValue(board,index,player,size,connect) {
  const opponent=3-player,row=Math.floor(index/size),col=index%size;
  board[index]=player;
  if(modeWinLine(board,index,player,size,connect).length) {board[index]=0;return 1e14;}
  let own=0,block=0,openThrees=0,openFours=0;
  for(const [dr,dc] of DIRS) {
    let count=1,openEnds=0;
    for(const sign of [-1,1]){
      let r=row+dr*sign,c=col+dc*sign;
      while(inside(r,c,size)&&board[spot(r,c,size)]===player){count++;r+=dr*sign;c+=dc*sign;}
      if(inside(r,c,size)&&board[spot(r,c,size)]===0)openEnds++;
    }
    if(count===connect-1&&openEnds===2)openFours++;
    if(count===connect-2&&openEnds===2)openThrees++;
  }
  for(const [dr,dc] of DIRS) for(let offset=0;offset<connect;offset++) {
    const sr=row-dr*offset,sc=col-dc*offset,er=sr+dr*(connect-1),ec=sc+dc*(connect-1);
    if(!inside(sr,sc,size)||!inside(er,ec,size)) continue;
    let mine=0,theirs=0,empty=0;
    for(let k=0;k<connect;k++){
      const v=board[spot(sr+dr*k,sc+dc*k,size)];
      if(v===player)mine++;else if(v===opponent)theirs++;else empty++;
    }
    if(!theirs)own=Math.max(own,windowValue(mine,connect));
    if(!mine)block=Math.max(block,windowValue(theirs,connect));
  }
  board[index]=0;
  const center=(size-1)/2;
  const centrality=Math.max(0,size-Math.abs(row-center)-Math.abs(col-center));
  return own+block*1.12+openFours*2e8+openThrees*1.8e5+centrality*0.2;
}
function evaluateBoard(board,size,connect,player){
  const opponent=3-player;
  let score=0;
  for(const [dr,dc] of DIRS) for(let r=0;r<size;r++) for(let c=0;c<size;c++){
    const er=r+dr*(connect-1),ec=c+dc*(connect-1);
    if(!inside(er,ec,size))continue;
    let mine=0,theirs=0;
    for(let k=0;k<connect;k++){
      const v=board[spot(r+dr*k,c+dc*k,size)];
      if(v===player)mine++;else if(v===opponent)theirs++;
    }
    if(mine&&theirs)continue;
    if(mine)score+=windowValue(mine,connect);
    else if(theirs)score-=windowValue(theirs,connect)*1.08;
  }
  return score;
}
function rankedCandidates(board,size,connect,player,limit){
  const candidates=randomCandidates(board,size,2);
  const immediate=modeWinningMoves(board,player,size,connect);
  if(immediate.length)return immediate;
  const mustBlock=modeWinningMoves(board,3-player,size,connect);
  if(mustBlock.length)return mustBlock;
  return candidates.map(i=>({i,score:Math.max(candidateValue(board,i,player,size,connect),candidateValue(board,i,3-player,size,connect)*0.98)}))
    .sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>x.i);
}
function search(board,size,connect,player,depth,alpha,beta,ply=0){
  const opponent=3-player;
  const last=board.lastIndexOf(3-player);
  if(last>=0&&modeWinLine(board,last,3-player,size,connect).length)return -1e13+ply;
  if(depth<=0||board.every(Boolean))return evaluateBoard(board,size,connect,player);
  const wins=modeWinningMoves(board,player,size,connect);
  if(wins.length)return 1e13-ply;
  const oppWins=modeWinningMoves(board,opponent,size,connect);
  if(oppWins.length>1)return -1e12+ply;
  let moves=rankedCandidates(board,size,connect,player,depth>=3?7:9);
  if(!moves.length)return 0;
  let best=-Infinity;
  for(const i of moves){
    board[i]=player;
    const score=modeWinLine(board,i,player,size,connect).length?1e13-ply:-search(board,size,connect,opponent,depth-1,-beta,-alpha,ply+1);
    board[i]=0;
    if(score>best)best=score;
    if(score>alpha)alpha=score;
    if(alpha>=beta)break;
  }
  return best;
}
export function chooseRandomMove(board,size,connect,player=2){
  if(!Array.isArray(board)||board.length!==size*size||connect<3||connect>10||size<connect)return -1;
  const wins=modeWinningMoves(board,player,size,connect);
  if(wins.length)return wins[0];
  const blocks=modeWinningMoves(board,3-player,size,connect);
  if(blocks.length)return blocks[0];
  const empty=board.filter(v=>v===0).length;
  if(!empty)return -1;
  const depth=connect<=3?4:connect<=5?3:connect<=7?2:2;
  const limit=connect<=4?10:connect<=6?8:7;
  const moves=rankedCandidates(board,size,connect,player,limit);
  let best=moves[0]??Math.floor(size/2)*size+Math.floor(size/2),bestScore=-Infinity;
  for(const i of moves){
    board[i]=player;
    const score=modeWinLine(board,i,player,size,connect).length?1e13: -search(board,size,connect,3-player,depth-1,-Infinity,-bestScore);
    board[i]=0;
    if(score>bestScore){bestScore=score;best=i;}
  }
  return best;
}
