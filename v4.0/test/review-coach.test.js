import test from "node:test";
import assert from "node:assert/strict";
import {buildReviewCoachContext,buildReviewCoachMessages,generateReviewCoach,reserveReviewCoachQuota} from "../worker/review-coach.js";
test("根据真实棋谱生成当前局面事实",()=>{
 const moves=[{i:112,p:1},{i:113,p:2},{i:97,p:1}];
 const ctx=buildReviewCoachContext({moves,step:3,playerColor:1});
 assert.equal(ctx.selected.coord,"H7");assert.equal(ctx.nextColor,2);
 assert.equal(ctx.recentMoves.length,3);
 const messages=buildReviewCoachMessages(ctx);
 assert.match(messages[1].content,/H7/);assert.match(messages[0].content,/不能编造胜率/);
});
test("拦截非法、重复落子或步数不匹配的棋谱",()=>{
 assert.throws(()=>buildReviewCoachContext({moves:[{i:112,p:2}],step:1,playerColor:1}));
 assert.throws(()=>buildReviewCoachContext({moves:[{i:112,p:1},{i:112,p:2}],step:2,playerColor:1}));
 assert.throws(()=>buildReviewCoachContext({moves:[{i:112,p:1}],step:0,playerColor:1}));
 assert.throws(()=>buildReviewCoachContext({moves:[],step:0,playerColor:3}));
});
test("在线模型缺失时回退离线而非抛出未处理异常",async()=>{
 await assert.rejects(generateReviewCoach({AI:null},{id:"test"},{moves:[],step:0,playerColor:1}),e=>e.status===503);
});
test("局面分析不修改原棋谱",()=>{const moves=[{i:112,p:1},{i:113,p:2}],serialized=JSON.stringify(moves);buildReviewCoachContext({moves,step:2,playerColor:2});assert.equal(JSON.stringify(moves),serialized);});

test("每人每天免费调用次数限制为 8，使用原子 SQL 扣减",async()=>{
 const used=new Map();
 const db={prepare(sql){return {bind(...args){return {
  async run(){if(sql.includes("INSERT OR IGNORE")){const key=args[0]+":"+args[1];if(!used.has(key))used.set(key,0);}return {meta:{changes:1}};},
  async first(){const key=args[0]+":"+args[1],value=used.get(key);if(value>=args[2])return null;used.set(key,value+1);return {used:value+1};}
 };}};}};
 for(let i=0;i<8;i++)await reserveReviewCoachQuota(db,"user-a","2026-11-04");
 await assert.rejects(reserveReviewCoachQuota(db,"user-a","2026-11-04"),e=>e.status===429);
 assert.equal(used.get("user:user-a:2026-11-04"),8);
 assert.equal(used.get("global:2026-11-04"),8);
});
test("全站每日免费推理上限 120 次，不能通过换账号突破",async()=>{
 const used=new Map();
 const db={prepare(sql){return {bind(...args){return {
  async run(){if(sql.includes("INSERT OR IGNORE")){const key=args[0]+":"+args[1];if(!used.has(key))used.set(key,0);}},
  async first(){const key=args[0]+":"+args[1],value=used.get(key);if(value>=args[2])return null;used.set(key,value+1);return {used:value+1};}
 };}};}};
 for(let i=0;i<120;i++)await reserveReviewCoachQuota(db,"user-"+i,"2026-11-04");
 await assert.rejects(reserveReviewCoachQuota(db,"user-overflow","2026-11-04"),e=>e.status===429);
 assert.equal(used.get("global:2026-11-04"),120);
});
