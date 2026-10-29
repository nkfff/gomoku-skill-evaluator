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
      assert.equal(puzzle.board[puzzle.solutionIndex],0);
      assert.equal(findPuzzleSolution(puzzle.board,difficulty,15,5),puzzle.solutionIndex);
      assert.equal(hasExistingWin(puzzle.board,15,5),false);
      assert.equal(modeWinningMoves(puzzle.board,2,15,5).length,0);
      if(difficulty==="easy") {
        assert.deepEqual(modeWinningMoves(puzzle.board,1,15,5),[puzzle.solutionIndex]);
      } else {
        assert.equal(modeWinningMoves(puzzle.board,1,15,5).length,0);
      }
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
