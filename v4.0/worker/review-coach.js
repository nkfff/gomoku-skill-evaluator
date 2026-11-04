// Streaming, position-grounded AI review. The deterministic engine supplies facts;
// GLM-4.7-Flash only explains them. Thinking is explicitly disabled for low latency.
import {CELLS,coord,immediateWins,pointShape,rankedMoves,winLine} from "../src/engine.js";

const MODEL="@cf/zai-org/glm-4.7-flash";
const PER_USER=8,GLOBAL=120;
const fail=(error,status=400)=>{throw {error,status};};

export function buildReviewCoachContext({moves,step,playerColor}={}){
 if(!Array.isArray(moves)||moves.length>CELLS||!Number.isInteger(step)||step!==moves.length||![1,2].includes(playerColor))fail("复盘参数不合法");
 const board=Array(CELLS).fill(0),before=Array(CELLS).fill(0);
 let terminal=false;
 for(let n=0;n<moves.length;n++){
  const m=moves[n];
  if(terminal||!m||!Number.isInteger(m.i)||m.i<0||m.i>=CELLS||board[m.i]||m.p!==n%2+1)fail("棋谱存在非法落子");
  if(n===step-1)for(let i=0;i<CELLS;i++)before[i]=board[i];
  board[m.i]=m.p;
  if(winLine(board,m.i,m.p).length||n===CELLS-1)terminal=true;
 }
 const selected=step?moves[step-1]:null,actor=selected?.p??1;
 const winningBefore=selected?immediateWins(before,actor):[],threatsBefore=selected?immediateWins(before,3-actor):[];
 const alternatives=rankedMoves(selected?before:board,actor,3);
 let verdict="暂无确定的强制胜负信号";
 if(selected){
  if(winningBefore.length)verdict=winningBefore.includes(selected.i)?"兑现了一步成五的机会":"错过己方一步成五点";
  else if(threatsBefore.length)verdict=immediateWins(board,3-actor).length?"对手仍有一步成五威胁":"本手化解了对手一步成五威胁";
  else if(alternatives.includes(selected.i))verdict="本手在有限启发式推荐列表内";
  else verdict="本手未进入启发式前三候选，不代表必然错误";
 }
 const next=terminal?null:step%2+1;
 return {
  step,playerColor,terminal,
  selected:selected?{color:actor,coord:coord(selected.i),shape:pointShape(before,selected.i,actor).kind}:null,
  recentMoves:moves.slice(-14).map((m,j)=>({number:step-Math.min(step,14)+j+1,color:m.p,coord:coord(m.i)})),
  verdict,winningBefore:winningBefore.map(coord),threatsBefore:threatsBefore.map(coord),alternatives:alternatives.map(coord),
  nextColor:next,nextWins:next?immediateWins(board,next).map(coord):[],nextThreats:next?immediateWins(board,3-next).map(coord):[],
  nextCandidates:next?rankedMoves(board,next,3).map(coord):[]
 };
}
export function buildReviewCoachMessages(context){
 const system="你是一名严谨的中文五子棋教练。15×15无禁手棋盘，黑先，五连胜。只根据服务器结构化棋局判断，不能编造胜率、必胜结论、职业定式、搜索深度、用户心态或未提供的具体坐标。候选点仅是轻量启发式建议，不代表证明。针对当前选中这一步回答，不要照搬模板。请以【局面判断】【这一步的取舍】【练习建议】三个小标题写约160到240字中文，优先引用当前步的实际落点、直接胜点和候选点；信息不充分就明确说明。";
 return [{role:"system",content:system},{role:"user",content:"以下是服务端实际落子分析，请围绕当前复盘步数给出简明、具体的教学建议。\n"+JSON.stringify(context)}];
}
async function reserveOne(db,scope,day,limit){
 await db.prepare("INSERT OR IGNORE INTO review_ai_daily_usage(scope,day,used) VALUES(?,?,0)").bind(scope,day).run();
 return !!(await db.prepare("UPDATE review_ai_daily_usage SET used=used+1 WHERE scope=? AND day=? AND used<? RETURNING used").bind(scope,day,limit).first());
}
async function releaseOne(db,scope,day){
 await db.prepare("UPDATE review_ai_daily_usage SET used=MAX(0,used-1) WHERE scope=? AND day=?").bind(scope,day).run();
}
export async function releaseReviewCoachQuota(db,userId,day){
 await Promise.all([releaseOne(db,"user:"+userId,day),releaseOne(db,"global",day)]).catch(()=>{});
}
export async function reserveReviewCoachQuota(db,userId,day){
 if(!await reserveOne(db,"user:"+userId,day,PER_USER))fail("今日在线 AI 次数已用完（每人8次），离线复盘仍可使用",429);
 if(!await reserveOne(db,"global",day,GLOBAL)){
  await releaseOne(db,"user:"+userId,day).catch(()=>{});
  fail("今日免费 AI 总额度已用完，请使用离线复盘",429);
 }
 return {day,userId};
}
function publicModelError(error){
 const message=String(error?.message||error||"");
 if(/429|capacity|neurons|quota|rate.?limit|overloaded/i.test(message))return "模型当前繁忙或免费推理额度暂时不足，请稍后再试。";
 if(/403|5035|not.?authorized|permission|not.?available/i.test(message))return "当前 Cloudflare 账户暂时无法调用该模型，请检查 Workers AI 账户权限。";
 return "在线 AI 服务暂时不可用，请稍后再试。";
}
function encodeEvent(encoder,event,data){
 return encoder.encode("event: "+event+"\ndata: "+JSON.stringify(data)+"\n\n");
}
export async function generateReviewCoachStream(env,user,payload,cors={}){
 const context=buildReviewCoachContext(payload);
 if(!env.AI?.run)fail("在线 AI 暂不可用，离线复盘仍可正常使用",503);
 const day=new Date().toISOString().slice(0,10);
 await reserveReviewCoachQuota(env.DB,user.id,day);
 let upstream;
 try{
  upstream=await env.AI.run(MODEL,{
   messages:buildReviewCoachMessages(context),
   stream:true,
   max_completion_tokens:360,
   temperature:0.25,
   top_p:0.82,
   reasoning_effort:"low",
   chat_template_kwargs:{enable_thinking:false}
  });
  if(!upstream||typeof upstream.getReader!=="function")throw new Error("Workers AI 未返回可读取的数据流");
 }catch(error){
  await releaseReviewCoachQuota(env.DB,user.id,day);
  fail(publicModelError(error),503);
 }
 const reader=upstream.getReader(),encoder=new TextEncoder(),decoder=new TextDecoder();
 let quotaSettled=false;
 const refund=async()=>{
  if(quotaSettled)return;
  quotaSettled=true;
  await releaseReviewCoachQuota(env.DB,user.id,day);
 };
 const body=new ReadableStream({
  async start(controller){
   let buffer="",hasText=false;
   const send=(event,data)=>{try{controller.enqueue(encodeEvent(encoder,event,data));}catch{}};
   const consume=frame=>{
    const data=frame.split(/\r?\n/).filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trim()).join("\n");
    if(!data||data==="[DONE]")return;
    let packet;
    try{packet=JSON.parse(data);}catch{return;}
    if(packet?.error||packet?.errors?.length)throw new Error(packet.error?.message||packet.error||"上游模型返回错误");
    let delta=packet?.choices?.[0]?.delta?.content;
    if(delta===undefined)delta=packet?.response;
    if(typeof delta==="number")delta=String(delta);
    if(typeof delta==="string"&&delta){
     hasText=true;
     send("delta",{text:delta});
    }
   };
   try{
    while(true){
     const {done,value}=await reader.read();
     if(done)break;
     buffer+=typeof value==="string"?value:decoder.decode(value,{stream:true});
     let boundary;
     while((boundary=buffer.search(/\r?\n\r?\n/))>=0){
      const frame=buffer.slice(0,boundary);
      const separator=buffer.slice(boundary).match(/^\r?\n\r?\n/)[0];
      buffer=buffer.slice(boundary+separator.length);
      consume(frame);
     }
    }
    buffer+=decoder.decode();
    if(buffer.trim())consume(buffer);
    if(!hasText){
     await refund();
     send("error",{error:"模型连接已建立，但没有返回有效文本。请稍后重试。"});
    }else{
     quotaSettled=true;
     send("done",{step:context.step,model:MODEL});
    }
    try{controller.close();}catch{}
   }catch(error){
    await refund();
    send("error",{error:publicModelError(error)});
    try{controller.close();}catch{}
   }finally{
    try{reader.releaseLock();}catch{}
   }
  },
  async cancel(reason){
   try{await reader.cancel(reason);}catch{}
   await refund();
  }
 });
 return new Response(body,{status:200,headers:{
  "Content-Type":"text/event-stream; charset=utf-8",
  "Cache-Control":"no-cache, no-transform",
  "X-Accel-Buffering":"no",
  ...cors
 }});
}
