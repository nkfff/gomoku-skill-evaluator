import test from "node:test";
import assert from "node:assert/strict";
import {buildReviewCoachContext,buildReviewCoachMessages,generateReviewCoachStream,reserveReviewCoachQuota,getReviewCoachQuota,reviewCoachQuotaSnapshot} from "../worker/review-coach.js";
function mockDb(){
 const used=new Map();
 const db={prepare(sql){return {bind(...args){return {
  async run(){
   if(sql.includes("INSERT OR IGNORE")){const key=args[0]+":"+args[1];if(!used.has(key))used.set(key,0);}
   else if(sql.includes("MAX(0,used-1)")){const key=args[0]+":"+args[1];used.set(key,Math.max(0,(used.get(key)||0)-1));}
   return {meta:{changes:1}};
  },
  async first(){
   const key=args[0]+":"+args[1],value=used.get(key)||0;
   if(sql.includes("SELECT used FROM"))return value?{used:value}:null;
   const limit=args[2];if(value>=limit)return null;
   used.set(key,value+1);return {used:value+1};
  }
 };}};}};
 return {db,used};
}
const sample={moves:[{i:112,p:1},{i:113,p:2},{i:97,p:1}],step:3,playerColor:1};
test("根据真实棋谱生成当前局面事实",()=>{
 const ctx=buildReviewCoachContext(sample);
 assert.equal(ctx.selected.coord,"H7");assert.equal(ctx.nextColor,2);assert.equal(ctx.recentMoves.length,3);
 const messages=buildReviewCoachMessages(ctx);assert.match(messages[1].content,/H7/);assert.match(messages[0].content,/不能编造胜率/);
});
test("拦截非法、重复落子或步数不匹配的棋谱",()=>{
 assert.throws(()=>buildReviewCoachContext({moves:[{i:112,p:2}],step:1,playerColor:1}));
 assert.throws(()=>buildReviewCoachContext({moves:[{i:112,p:1},{i:112,p:2}],step:2,playerColor:1}));
 assert.throws(()=>buildReviewCoachContext({moves:[{i:112,p:1}],step:0,playerColor:1}));
 assert.throws(()=>buildReviewCoachContext({moves:[],step:0,playerColor:3}));
});
test("在线模型缺失时返回明确降级错误",async()=>{
 await assert.rejects(generateReviewCoachStream({AI:null,DB:mockDb().db},{id:"test"},sample),e=>e.status===503);
});
test("局面分析不修改原棋谱",()=>{const moves=sample.moves,serialized=JSON.stringify(moves);buildReviewCoachContext({moves,step:3,playerColor:2});assert.equal(JSON.stringify(moves),serialized);});
test("每人每天免费调用次数限制为 8",async()=>{
 const {db,used}=mockDb();for(let i=0;i<8;i++)await reserveReviewCoachQuota(db,"user-a","2026-11-04");
 await assert.rejects(reserveReviewCoachQuota(db,"user-a","2026-11-04"),e=>e.status===429);
 assert.equal(used.get("user:user-a:2026-11-04"),8);assert.equal(used.get("global:2026-11-04"),8);
});
test("全站每日免费推理上限 120 次，超限时回滚用户额度",async()=>{
 const {db,used}=mockDb();for(let i=0;i<120;i++)await reserveReviewCoachQuota(db,"user-"+i,"2026-11-04");
 await assert.rejects(reserveReviewCoachQuota(db,"user-overflow","2026-11-04"),e=>e.status===429);
 assert.equal(used.get("global:2026-11-04"),120);assert.equal(used.get("user:user-overflow:2026-11-04"),0);
});
test("流式输出、关闭 GLM 思考模式并在完成后保留一次额度",async()=>{
 const {db,used}=mockDb(),encoder=new TextEncoder();let options;
 const upstream=new ReadableStream({start(c){
  c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"【局面判断】"}}]}\n\n'));
  c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" 当前一步是 H7。"}}]}\n\n'));
  c.enqueue(encoder.encode("data: [DONE]\n\n"));c.close();
 }});
 const response=await generateReviewCoachStream({DB:db,AI:{async run(model,input){options={model,...input};return upstream;}}},{id:"user-stream"},sample,{"Access-Control-Allow-Origin":"https://nkfff.github.io"});
 assert.equal(response.status,200);assert.match(response.headers.get("content-type"),/text\/event-stream/);
 assert.equal(options.stream,true);assert.equal(options.chat_template_kwargs.enable_thinking,false);assert.equal(options.reasoning_effort,"low");assert.equal(options.max_completion_tokens,360);
 const body=await response.text();assert.match(body,/event: delta/);assert.match(body,/【局面判断】/);assert.match(body,/event: done/);
 const day=new Date().toISOString().slice(0,10);assert.equal(used.get("user:user-stream:"+day),1);
});
test("模型启动失败时释放用户和全站额度",async()=>{
 const {db,used}=mockDb();
 await assert.rejects(generateReviewCoachStream({DB:db,AI:{async run(){throw new Error("429 capacity exceeded");}}},{id:"user-fail"},sample),e=>e.status===503&&/繁忙/.test(e.error));
 const day=new Date().toISOString().slice(0,10);assert.equal(used.get("user:user-fail:"+day),0);assert.equal(used.get("global:"+day),0);
});
test("流式模型无有效内容时释放额度并发出错误事件",async()=>{
 const {db,used}=mockDb(),encoder=new TextEncoder();
 const upstream=new ReadableStream({start(c){c.enqueue(encoder.encode("data: [DONE]\n\n"));c.close();}});
 const response=await generateReviewCoachStream({DB:db,AI:{async run(){return upstream;}}},{id:"user-empty"},sample);
 const body=await response.text(),day=new Date().toISOString().slice(0,10);
 assert.match(body,/event: error/);assert.equal(used.get("user:user-empty:"+day),0);assert.equal(used.get("global:"+day),0);
});

test("查询额度：新用户每日8次，可用额度归零时禁用且给出UTC重置时间",async()=>{
 const {db}=mockDb();
 const date="2026-11-04";
 const fresh=await getReviewCoachQuota(db,"guest-1",date);
 assert.equal(fresh.user.remaining,8);
 assert.equal(fresh.global.remaining,120);
 assert.equal(fresh.canUse,true);
 assert.equal(fresh.resetAtUTC,"2026-11-05T00:00:00.000Z");
 for(let i=0;i<8;i++)await reserveReviewCoachQuota(db,"guest-1",date);
 const empty=await getReviewCoachQuota(db,"guest-1",date);
 assert.equal(empty.user.used,8);
 assert.equal(empty.user.remaining,0);
 assert.equal(empty.canUse,false);
 assert.equal(empty.reason,"user_exhausted");
 const tomorrow=await getReviewCoachQuota(db,"guest-1","2026-11-05");
 assert.equal(tomorrow.user.remaining,8);
 assert.equal(tomorrow.global.remaining,120);
});
test("全站额度不足时每个人即使尚有次数也无法调用",()=>{
 const state=reviewCoachQuotaSnapshot(1,120,"2026-11-04");
 assert.equal(state.user.remaining,7);
 assert.equal(state.global.remaining,0);
 assert.equal(state.canUse,false);
 assert.equal(state.reason,"global_exhausted");
});
test("查询额度只读取服务端记录，不因页面刷新而清零",async()=>{
 const {db}=mockDb();
 await reserveReviewCoachQuota(db,"persistent","2026-11-04");
 const first=await getReviewCoachQuota(db,"persistent","2026-11-04");
 const second=await getReviewCoachQuota(db,"persistent","2026-11-04");
 assert.deepEqual(first,second);
 assert.equal(second.user.remaining,7);
});
