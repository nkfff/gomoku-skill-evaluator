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

import {analyzeMove,summarizeQuality,ANALYSIS_VERSION} from "../src/assessment.js";
test("depth-2 evaluation ranks an immediate win at Top-1",()=>{
 const b=Array(CELLS).fill(0);
 for(let c=4;c<8;c++)b[spot(7,c)]=1;
 const best=spot(7,8),q=analyzeMove(b,1,best);
 assert.equal(q.top1,true);
 assert.equal(q.top3,true);
 assert.equal(q.loss,0);
 assert.equal(q.severe,false);
 const miss=analyzeMove(b,1,spot(9,9));
 assert.equal(miss.severe,true);
 assert.match(miss.category,/漏杀/);
});
test("must-block errors are severe and input board remains unchanged",()=>{
 const b=Array(CELLS).fill(0);
 for(let c=4;c<8;c++)b[spot(7,c)]=2;
 const old=b.slice();
 const q=analyzeMove(b,1,spot(9,9));
 assert.equal(q.severe,true);
 assert.match(q.category,/漏防/);
 assert.deepEqual(b,old);
});
test("quality score uses rates rather than farming absolute good-move counts",()=>{
 const quality={version:ANALYSIS_VERSION,top1:true,top3:true,severe:false,accuracy:100};
 const a=summarizeQuality([{p:1,seconds:2,quality}]);
 const b=summarizeQuality(Array.from({length:12},()=>({p:1,seconds:2,quality})));
 assert.equal(a.score,100);
 assert.equal(a.score,b.score);
 assert.equal(a.top1,1);
 assert.equal(a.top3,1);
 assert.equal(a.severeRate,0);
});
