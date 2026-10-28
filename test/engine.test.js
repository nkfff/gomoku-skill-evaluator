import test from "node:test";
import assert from "node:assert/strict";
import {SIZE,CELLS,spot,winLine,candidates,immediateWins,chooseAI,advice,replay} from "../src/engine.js";
test("15x15 board and center opening",()=>{
 assert.equal(SIZE,15);assert.equal(CELLS,225);
 assert.deepEqual(candidates(Array(CELLS).fill(0)),[112]);
});
test("horizontal, vertical and diagonal five",()=>{
 for(const [dy,dx] of [[0,1],[1,0],[1,1],[1,-1]]){
  const b=Array(CELLS).fill(0),y=6,x=6;
  for(let k=0;k<5;k++)b[spot(y+dy*k,x+dx*k)]=1;
  assert.ok(winLine(b,spot(y,x),1).length>=5);
 }
});
test("immediate wins and defensive AI",()=>{
 const b=Array(CELLS).fill(0);
 for(let c=4;c<8;c++)b[spot(7,c)]=1;
 assert.ok(immediateWins(b,1).includes(spot(7,8)));
 for(const level of ["easy","normal","hard"]){
  const move=chooseAI(b.slice(),level);
  assert.ok([spot(7,3),spot(7,8)].includes(move.index));
 }
});
test("AI completes immediate five",()=>{
 const b=Array(CELLS).fill(0);
 for(let c=4;c<8;c++)b[spot(7,c)]=2;
 const result=chooseAI(b,"hard");
 assert.ok([spot(7,3),spot(7,8)].includes(result.index));
});
test("analysis and replay preserve all steps",()=>{
 const b=Array(CELLS).fill(0);
 const x=spot(7,7),y=spot(7,8);
 assert.ok(advice(b,1,x).alternatives.length>0);
 const frames=replay([{i:x,p:1},{i:y,p:2}]);
 assert.equal(frames.length,3);assert.equal(frames[0][x],0);assert.equal(frames[1][x],1);assert.equal(frames[2][y],2);
 assert.throws(()=>replay([{i:x,p:1},{i:x,p:2}]));
});
