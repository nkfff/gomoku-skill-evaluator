import test from "node:test";
import assert from "node:assert/strict";
import {
  PUZZLE_LEVELS, generatePuzzle, findPuzzleSolution, modeWinLine,
  modeWinningMoves, createRandomConfig, chooseRandomMove
} from "../src/special-modes.js";

function hasExistingWin(board,size,connect) {
  for(let i=0;i<board.length;i++) {
    if(board[i] && modeWinLine(board,i,board[i],size,connect).length) return true;
  }
  return false;
}

test("each puzzle difficulty generates varied, validated, uniquely solvable positions", () => {
  for(const difficulty of Object.keys(PUZZLE_LEVELS)) {
    const seen = new Set();
    for(let seed=1;seed<=12;seed++) {
      const puzzle=generatePuzzle(difficulty,seed*7919);
      assert.equal(puzzle.size,15);
      assert.equal(puzzle.connect,5);
      assert.equal(puzzle.board.length,225);
      const expectedStones=difficulty==="easy"?14:difficulty==="normal"?18:22;
      assert.equal(puzzle.board.filter(Boolean).length,expectedStones,"fixed clue count per difficulty");
      assert.equal(puzzle.board[puzzle.solutionIndex],0);
      assert.equal(findPuzzleSolution(puzzle.board,difficulty,15,5),puzzle.solutionIndex);
      assert.equal(hasExistingWin(puzzle.board,15,5),false);
      assert.equal(modeWinningMoves(puzzle.board,2,15,5).length,0);
      assert.equal(modeWinningMoves(puzzle.board,1,15,5).length,0,"no one-move win: puzzles must require a sequence");
      assert.equal(puzzle.solutionSequence.length,3);
      assert.equal(puzzle.solutionSequence[0],puzzle.solutionIndex);
      assert.equal(new Set(puzzle.solutionSequence).size,3);
      assert.ok(puzzle.solutionSequence.slice(1).every(i=>puzzle.board[i]===0));
      seen.add(puzzle.board.join(""));
    }
    assert.ok(seen.size>=10, difficulty+" puzzles should be varied");
  }
});

test("puzzle generation is deterministic for a fixed seed", () => {
  for(const difficulty of Object.keys(PUZZLE_LEVELS)) {
    const a=generatePuzzle(difficulty,123456);
    const b=generatePuzzle(difficulty,123456);
    assert.deepEqual(a.board,b.board);
    assert.equal(a.solutionIndex,b.solutionIndex);
  }
});

test("random connect and board size always leave ample playing space", () => {
  for(let seed=1;seed<=500;seed++) {
    const {size,connect}=createRandomConfig(seed);
    assert.ok(connect>=3 && connect<=10);
    assert.ok(size>=11 && size<=29);
    assert.ok(size>=2*connect+3);
    assert.equal(size*size>connect*connect,true);
  }
});

test("variable-connect AI takes a win before making a positional move", () => {
  const size=11,connect=3,board=Array(size*size).fill(0);
  board[5*size+4]=2; board[5*size+5]=2;
  const move=chooseRandomMove(board,size,connect,2);
  board[move]=2;
  assert.ok(modeWinLine(board,move,2,size,connect).length>=connect);
});

test("variable-connect AI blocks an immediate opponent win", () => {
  const size=11,connect=3,board=Array(size*size).fill(0);
  board[5*size+3]=2; // block one end so only the right endpoint remains a threat
  board[5*size+4]=1; board[5*size+5]=1;
  const move=chooseRandomMove(board,size,connect,2);
  board[move]=2;
  assert.equal(modeWinningMoves(board,1,size,connect).length,0);
  assert.equal(move,5*size+6);
});

test("AI takes immediate wins and blocks immediate losses for every connect length", () => {
  for(let connect=3;connect<=10;connect++) {
    const size=Math.max(2*connect+3,connect+5);
    const row=Math.floor(size/2),start=Math.floor(size/2)-Math.floor((connect-1)/2);
    const winBoard=Array(size*size).fill(0);
    for(let k=0;k<connect-1;k++)winBoard[row*size+start+k]=2;
    const winMove=chooseRandomMove(winBoard,size,connect,2);
    assert.ok(modeWinLine([...winBoard.map((v,i)=>i===winMove?2:v)],winMove,2,size,connect).length>=connect,
      "AI should take immediate win at connect="+connect);

    const blockBoard=Array(size*size).fill(0);
    for(let k=0;k<connect-1;k++)blockBoard[row*size+start+k]=1;
    blockBoard[(row-2)*size+(start-2)]=2;
    const blockMove=chooseRandomMove(blockBoard,size,connect,2);
    blockBoard[blockMove]=2;
    assert.equal(modeWinningMoves(blockBoard,1,size,connect).length,0,
      "AI should block immediate loss at connect="+connect);
  }
});

test("AI prefers forcing threats over random extension on connect-5", () => {
  const size=15,connect=5,board=Array(size*size).fill(0);
  const row=7;
  board[row*size+5]=2;board[row*size+6]=2;board[row*size+7]=2;
  board[(row+1)*size+6]=1;board[(row-1)*size+6]=1;
  const move=chooseRandomMove(board,size,connect,2);
  board[move]=2;
  assert.ok(modeWinLine(board,move,2,size,connect).length===0);
  assert.ok(Math.floor(move/size)===row && move>=row*size+3 && move<=row*size+9,
    "AI should extend or support its active threat rather than play far away");
});
