// Optional AI commentary; every factual square comes from the server's own board analysis.
import {CELLS,coord,immediateWins,pointShape,rankedMoves,winLine} from "../src/engine.js";
const MODEL="@cf/zai-org/glm-4.7-flash",PER_USER=8,GLOBAL=120;
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
 const system="你是一名严谨的中文五子棋教练。15×15无禁手棋盘，黑先，五连胜。只根据服务器结构化棋局判断，不能编造胜率、必胜结论、职业定式、搜索深度、用户心态或未提供的具体坐标。候选点仅是轻量启发式建议，不代表证明。针对当前选中这一步回答，不要照搬模板。请以【局面判断】【这一步的取舍】【练习建议】三个小标题写约180到320字中文，每段包含具体的局面事实或方法，信息不充分就明确说明。";
 return [{role:"system",content:system},{role:"user",content:"以下是服务端实际落子分析，请围绕当前复盘步数给出教学建议。\n"+JSON.stringify(context)}];
}
export async function reserveReviewCoachQuota(db,userId,day){
 const reserve=async(scope,limit)=>{
  await db.prepare("INSERT OR IGNORE INTO review_ai_daily_usage(scope,day,used) VALUES(?,?,0)").bind(scope,day).run();
  return !!(await db.prepare("UPDATE review_ai_daily_usage SET used=used+1 WHERE scope=? AND day=? AND used<? RETURNING used").bind(scope,day,limit).first());
 };
 if(!await reserve("user:"+userId,PER_USER))fail("今日在线 AI 次数已用完（每人8次），离线复盘仍可使用",429);
 if(!await reserve("global",GLOBAL))fail("今日免费 AI 总额度已用完，请使用离线复盘",429);
}
export async function generateReviewCoach(env,user,payload){
 const context=buildReviewCoachContext(payload);
 if(!env.AI?.run)fail("在线 AI 暂不可用，离线复盘仍可正常使用",503);
 await reserveReviewCoachQuota(env.DB,user.id,new Date().toISOString().slice(0,10));
 try{
  const response=await env.AI.run(MODEL,{messages:buildReviewCoachMessages(context),max_completion_tokens:500,temperature:0.35});
  const content=typeof response?.response==="string"?response.response:response?.choices?.[0]?.message?.content;
  if(typeof content!=="string"||!content.trim())fail("在线 AI 未返回有效讲解，请使用离线复盘",503);
  return {text:content.trim().slice(0,1800),model:MODEL,step:context.step};
 }catch(err){
  if(err?.status)throw err;
  fail("在线 AI 繁忙或免费额度不足，请使用离线复盘",503);
 }
}
