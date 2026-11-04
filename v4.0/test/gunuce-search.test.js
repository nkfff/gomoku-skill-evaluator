import test from 'node:test';
import assert from 'node:assert/strict';
import {Node,search,backup,encode,fastWins,won,validatePosition} from '../src/gunuce-search.js';
const infer=async state=>({policy:new Float32Array(225),value:0});
test('local PUCT visits normalize and never mutate the board',async()=>{
 const board=new Int8Array(225);board[112]=1;const before=board.slice(),root=new Node(board,2,112),result=await search(root,infer,{simulations:16});assert.deepEqual(board,before);assert.equal(result.policy[112],0);assert.equal(root.n.reduce((a,b)=>a+b),16);assert(Math.abs(result.policy.reduce((a,b)=>a+b)-1)<1e-6);
});
test('terminal value backup uses side-to-move signs',()=>{
 const a={n:new Int32Array(1),w:new Float64Array(1)},b={n:new Int32Array(1),w:new Float64Array(1)};backup([[a,0],[b,0]],1);assert.equal(a.w[0],1);assert.equal(b.w[0],-1);
});
test('must block and immediate win are found across board edges',async()=>{
 const board=new Int8Array(225);for(let i=0;i<4;i++)board[i]=1;assert.deepEqual(fastWins(board,1),[4]);const root=new Node(board,2);assert.equal((await search(root,infer,{simulations:4})).index,4);const attacker=new Node(board,1);assert.equal((await search(attacker,infer,{simulations:4})).index,4);assert.equal(attacker.children.get(0).winner,1);
});
test('encoding, turn validation and cancellation',async()=>{
 const b=new Int8Array(225);b[112]=1;validatePosition(b,2,112);const x=encode(b,2,112);assert.equal(x[225+112],1);assert.equal(x[450+112],1);assert.equal(x[675],0);assert.throws(()=>validatePosition(b,1,112));let cancelled=false;await assert.rejects(search(new Node(b,2,112),infer,{simulations:16,onProgress:()=>{cancelled=true},isCancelled:()=>cancelled}),/取消/);
});

test('Legacy FPU search matches independent Python reference visits',async()=>{
 const {readFileSync}=await import('node:fs'),cases=JSON.parse(readFileSync(new URL('./fixtures/gunuce-search.json',import.meta.url),'utf8'));
 for(const c of cases){const root=new Node(c.board,c.player,c.last),result=await search(root,async()=>({policy:Float32Array.from({length:225},(_,i)=>(i%13)*.25),value:0}),{simulations:c.simulations,fpuReduction:null});const visits=Array(225).fill(0);root.actions.forEach((a,i)=>visits[a]=root.n[i]);assert.equal(c.visits[result.index],Math.max(...c.visits),c.name);assert.deepEqual(visits,c.visits,c.name)}
});


test('corrected FPU search matches independent Python visits for negative values',async()=>{
 const {readFileSync}=await import('node:fs'),cases=JSON.parse(readFileSync(new URL('./fixtures/gunuce-opening-search.json',import.meta.url),'utf8'));
 for(const c of cases){const root=new Node(c.board,c.player,c.last),result=await search(root,async()=>({policy:Float32Array.from(c.logits),value:c.value}),{simulations:c.simulations});const visits=Array(225).fill(0);root.actions.forEach((a,i)=>visits[a]=root.n[i]);assert.equal(result.index,c.index,c.name);assert.deepEqual(visits,c.visits,c.name)}
});

test('equal visits choose the stronger prior instead of the smallest coordinate',async()=>{
 const root=new Node(new Int8Array(225),1);root.expand(Float32Array.from({length:225},(_,i)=>i/225));root.n.fill(1);root.n[224]=0;root.value=1;
 const result=await search(root,infer,{simulations:1});assert.equal(result.index,224);
});
