import test from "node:test";
import assert from "node:assert/strict";
import {
  PUZZLE_LEVELS, generatePuzzle, verifyPuzzleLine, modeWinLine,
  modeWinningMoves, createRandomConfig, chooseRandomMove, evaluateRandomBoard
} from "../src/special-modes.js";

function hasExistingWin(board,size,connect) {
  for(let i=0;i<board.length;i++) {
    if(board[i]&&modeWinLine(board,i,board[i],size,connect).length)return true;
  }
  return false;
}

test("each puzzle is a validated multi-step forced line with one winning defence point per stage",()=>{
  for(const difficulty of Object.keys(PUZZLE_LEVELS)) {
    const seen=new Set();
    for(let seed=1;seed<=8;seed++) {
      const puzzle=generatePuzzle(difficulty,seed*7919);
      assert.equal(verifyPuzzleLine(puzzle),true);
      assert.equal(puzzle.size,21);
      assert.equal(puzzle.connect,5);
      assert.equal(puzzle.solutionMoves.length,PUZZLE_LEVELS[difficulty].steps);
      assert.equal(puzzle.solutionResponses.length,PUZZLE_LEVELS[difficulty].steps-1);
      assert.equal(puzzle.board.length,441);
      assert.equal(hasExistingWin(puzzle.board,puzzle.size,puzzle.connect),false);
      assert.equal(modeWinningMoves(puzzle.board,1,puzzle.size,puzzle.connect).length,0);
      assert.equal(modeWinningMoves(puzzle.board,2,puzzle.size,puzzle.connect).length,0);
      const board=puzzle.board.slice();
      for(let i=0;i<puzzle.solutionMoves.length-1;i++) {
        const move=puzzle.solutionMoves[i],response=puzzle.solutionResponses[i];
        assert.equal(board[move],0);
        board[move]=1;
        assert.deepEqual(modeWinningMoves(board,1,puzzle.size,puzzle.connect),[response]);
        assert.equal(modeWinningMoves(board,2,puzzle.size,puzzle.connect).length,0);
        board[response]=2;
        assert.equal(modeWinningMoves(board,1,puzzle.size,puzzle.connect).length,0);
      }
      const finalMove=puzzle.solutionMoves.at(-1);
      board[finalMove]=1;
      const wins=modeWinningMoves(board,1,puzzle.size,puzzle.connect);
      assert.equal(wins.length,2);
      assert.deepEqual([...wins].sort((a,b)=>a-b),[...puzzle.finalWins].sort((a,b)=>a-b));
      seen.add(puzzle.board.join(""));
    }
    assert.equal(seen.size,8,difficulty+" puzzles should vary by seed");
  }
});

test("puzzle generation is deterministic for a fixed seed",()=>{
  for(const difficulty of Object.keys(PUZZLE_LEVELS)) {
    const a=generatePuzzle(difficulty,123456),b=generatePuzzle(difficulty,123456);
    assert.deepEqual(a.board,b.board);
    assert.deepEqual(a.solutionMoves,b.solutionMoves);
    assert.deepEqual(a.solutionResponses,b.solutionResponses);
  }
});

test("random connect and board size always leave ample playing space",()=>{
  for(let seed=1;seed<=500;seed++) {
    const {size,connect}=createRandomConfig(seed);
    assert.ok(connect>=3&&connect<=10);
    assert.ok(size>=11&&size<=29);
    assert.ok(size>=2*connect+3);
    assert.ok(size*size>connect*connect);
  }
});

test("variable-connect AI takes a win for every connect target",()=>{
  for(let connect=3;connect<=10;connect++) {
    const size=Math.max(11,2*connect+3),row=Math.floor(size/2),board=Array(size*size).fill(0);
    board[row*size+3]=1;
    for(let k=0;k<connect-1;k++)board[row*size+4+k]=2;
    const move=chooseRandomMove(board,size,connect,2);
    board[move]=2;
    assert.ok(modeWinLine(board,move,2,size,connect).length>=connect,"connect="+connect);
  }
});

test("variable-connect AI blocks a single immediate opponent win for every connect target",()=>{
  for(let connect=3;connect<=10;connect++) {
    const size=Math.max(11,2*connect+3),row=Math.floor(size/2),board=Array(size*size).fill(0);
    board[row*size+3]=2;
    for(let k=0;k<connect-1;k++)board[row*size+4+k]=1;
    const move=chooseRandomMove(board,size,connect,2);
    board[move]=2;
    assert.equal(modeWinningMoves(board,1,size,connect).length,0,"connect="+connect);
    assert.equal(move,row*size+4+connect-1,"connect="+connect);
  }
});

test("variable-connect AI blocks an opponent's two-direction fork before it is created",()=>{
  const size=13,connect=5,board=Array(size*size).fill(0),row=5,col=5;
  for(const c of [4,6,7])board[row*size+c]=1;
  for(const r of [4,6,7])board[r*size+col]=1;
  assert.equal(modeWinningMoves(board,1,size,connect).length,0);
  assert.equal(chooseRandomMove(board,size,connect,2),row*size+col);
});

test("connect-specific evaluation increases urgency as a line approaches its target",()=>{
  const size=25,board=Array(size*size).fill(0),row=12;
  for(const c of [10,11,12])board[row*size+c]=1;
  assert.ok(evaluateRandomBoard(board,size,5,1)>evaluateRandomBoard(board,size,10,1));
});
