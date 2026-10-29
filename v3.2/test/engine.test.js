import test from "node:test";
import assert from "node:assert/strict";
import {LEVELS, chooseAI, immediateWins, winLine} from "../src/engine.js";

const at=(row,col)=>row*15+col;

test("王者难度使用更深、更宽的搜索配置",()=>{
  assert.equal(LEVELS.hard.label,"王者");
  assert.equal(LEVELS.hard.depth,3);
  assert.equal(LEVELS.hard.width,9);
});

test("AI takes a direct win before considering positional scores",()=>{
  const board=Array(225).fill(0);
  for(let c=4;c<8;c++)board[at(7,c)]=2;
  const result=chooseAI(board,"hard");
  assert.ok(winLine([...board.map((v,i)=>i===result.index?2:v)],result.index,2).length>=5);
  assert.equal(result.reason,"直接成五");
});

test("AI blocks a unique immediate opponent win",()=>{
  const board=Array(225).fill(0);
  board[at(7,4)]=2; // close the left endpoint
  for(let c=5;c<9;c++)board[at(7,c)]=1;
  const result=chooseAI(board,"hard");
  assert.equal(result.index,at(7,9));
  assert.equal(immediateWins([...board.map((v,i)=>i===result.index?2:v)],1).length,0);
  assert.equal(result.reason,"紧急堵五");
});

test("search does not mutate the caller's board and returns a legal move",()=>{
  const board=Array(225).fill(0);
  board[at(7,7)]=1;
  board[at(7,8)]=2;
  board[at(8,8)]=1;
  board[at(6,7)]=2;
  const original=board.slice();
  const result=chooseAI(board,"hard");
  assert.ok(Number.isInteger(result.index)&&result.index>=0&&result.index<225);
  assert.equal(original[result.index],0);
  assert.deepEqual(board,original);
  assert.ok(result.nodes>0);
  assert.match(result.reason,/王者模式/);
});
