import test from "node:test";
import assert from "node:assert/strict";
import {LEVELS, chooseAI, immediateWins, winLine} from "../src/engine.js";

const at=(row,col)=>row*15+col;

test("王者难度使用更深、更宽的搜索配置",()=>{
  assert.equal(LEVELS.hard.label,"王者");
  assert.equal(LEVELS.hard.depth,14);
  assert.equal(LEVELS.hard.width,14);
  assert.equal(LEVELS.hard.timeMs,2400);
  assert.equal(LEVELS.hard.maxDepth,14);
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


test("difficulty rewards remain exactly 10 / 30 / 80",()=>{
 assert.equal(LEVELS.easy.reward,10);
 assert.equal(LEVELS.normal.reward,30);
 assert.equal(LEVELS.hard.reward,80);
});
test("King AI immediately wins and blocks a one-move loss",()=>{
 const win=Array(225).fill(0);
 for(let c=4;c<8;c++)win[spot(7,c)]=2;
 const winMove=chooseAI(win,"hard");
 assert.ok(winMove.index===at(7,3)||winMove.index===at(7,8));
 const block=Array(225).fill(0);
 for(let c=4;c<8;c++)block[spot(7,c)]=1;
 const blockMove=chooseAI(block,"hard");
 assert.ok(blockMove.index===at(7,3)||blockMove.index===at(7,8));
});
test("time-bounded search returns a legal move and never mutates the source board",()=>{
 const b=Array(225).fill(0);
 for(const [i,p] of [[112,1],[113,2],[97,1],[128,2],[111,1],[98,2]])b[i]=p;
 const original=b.slice();
 const result=chooseAI(b,"hard",{timeMs:80,maxDepth:3,width:8});
 assert.ok(Number.isInteger(result.index)&&result.index>=0&&result.index<225);
 assert.equal(original[result.index],0);
 assert.deepEqual(b,original);
 assert.ok(result.nodes>=0);
 assert.ok(result.depth>=0);
});
test("King AI has a wider and longer search budget than normal",()=>{
 assert.ok(LEVELS.hard.width>LEVELS.normal.width);
 assert.ok(LEVELS.hard.timeMs>=2000);
 assert.ok(LEVELS.hard.maxDepth>=10);
});
