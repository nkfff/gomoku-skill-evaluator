import {createRemoteJWKSet,jwtVerify} from "jose";
import {LEVELS,CELLS,winLine,chooseAI,rankedMoves,coord} from "../src/engine.js";

const award={easy:10,normal:30,hard:80};
const boards={classic:0,jade:60,night:150,cherry:260,catcafe:480,gold:500};
const pieces={classic:0,crystal:45,ink:85,neon:140,pearl:220,cat:680};
const reply=(x,status=200,cors={})=>new Response(JSON.stringify(x),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...cors}});
const invalid=(s,status=400)=>({error:s,status});
const uuid=s=>typeof s==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const clean=x=>String(x??"").trim().slice(0,24);
const JSONparse=(x,fallback)=>{try{return JSON.parse(x);}catch{return fallback;}};
let lastJwksUrl="", jwks;
async function authenticate(request,env){
 const header=request.headers.get("Authorization")||"";
 const token=header.match(/^Bearer\s+(\S+)$/i)?.[1];
 if(!token||!env.SUPABASE_URL)throw invalid("需要登录",401);
 const origin=env.SUPABASE_URL.replace(/\/$/,"");
 const jwksUrl=origin+"/auth/v1/.well-known/jwks.json";
 if(lastJwksUrl!==jwksUrl){jwks=createRemoteJWKSet(new URL(jwksUrl));lastJwksUrl=jwksUrl;}
 try{
  const {payload}=await jwtVerify(token,jwks,{issuer:origin+"/auth/v1",audience:"authenticated",algorithms:["ES256","RS256"]});
  if(!uuid(payload.sub)||payload.role!=="authenticated")throw Error("Not a user token");
  return {id:payload.sub,email:typeof payload.email==="string"?payload.email:null};
 }catch{throw invalid("登录已过期或身份验证失败",401);}
}
async function ensure(env,user){
 await env.DB.prepare("INSERT OR IGNORE INTO players(id,name,points,wins,losses,draws,inventory,created_at,email) VALUES(?,'匿名棋手',0,0,0,0,'[\"classic\",\"board:classic\",\"piece:classic\"]',datetime('now'),?)").bind(user.id,user.email).run();
}
async function profile(env,id){
 const u=await env.DB.prepare("SELECT id,name,points,earned_points,wins,losses,draws,inventory,selected_board,selected_piece,banned FROM players WHERE id=?").bind(id).first();
 return u?{...u,inventory:JSONparse(u.inventory,[]),isAdmin:id===env.ADMIN_USER_ID}:null;
}
function validMoves(moves){
 const b=Array(CELLS).fill(0);
 for(let n=0;n<moves.length;n++){
  const m=moves[n];
  if(!Number.isInteger(m.i)||m.i<0||m.i>=CELLS||b[m.i]||m.p!==(n%2===0?1:2))throw invalid("棋谱不合法",409);
  b[m.i]=m.p;
 }
 return b;
}
export function validateSubmittedTimeline(events,level,reportedResult,reportedUndoCount){
 if(!Array.isArray(events)||events.length<2||events.length>500)throw invalid("终局事件数量不合法");
 const b=Array(CELLS).fill(0),moves=[];
 let pendingAI=false,terminal=0,seenEnd=false,undoCount=0;
 for(let n=0;n<events.length;n++){
  const event=events[n];
  if(!event||typeof event!=="object"||seenEnd)throw invalid("终局事件顺序不合法",409);
  if(event.type==="move"){
   if(terminal||!Number.isInteger(event.i)||event.i<0||event.i>=CELLS||b[event.i])throw invalid("棋谱包含非法落子",409);
   if(event.p===1){
    if(pendingAI||moves.length%2!==0)throw invalid("玩家落子顺序不合法",409);
    moves.push({i:event.i,p:1});b[event.i]=1;
    if(winLine(b,event.i,1).length)terminal=1;
    else if(moves.length===CELLS)terminal=3;
    else pendingAI=true;
   }else if(event.p===2){
    if(!pendingAI||moves.length%2!==1)throw invalid("AI 落子顺序不合法",409);
    if(!rankedMoves(b,2,LEVELS[level].width).includes(event.i))throw invalid("AI 落子不在当前难度的候选范围内",409);
    moves.push({i:event.i,p:2});b[event.i]=2;pendingAI=false;
    if(winLine(b,event.i,2).length)terminal=2;
    else if(moves.length===CELLS)terminal=3;
   }else throw invalid("棋子颜色不合法",409);
  }else if(event.type==="undo"){
   if(terminal||pendingAI||moves.length<2)throw invalid("悔棋事件不合法",409);
   const removed=moves.slice(-2).map(m=>coord(m.i));
   if(!Array.isArray(event.removed)||JSON.stringify(event.removed)!==JSON.stringify(removed))throw invalid("悔棋记录与棋谱不一致",409);
   moves.splice(-2);b.fill(0);for(const move of moves)b[move.i]=move.p;
   undoCount++;
   const paid=undoCount>3,cost=paid?10:0;
   if(event.paid!==paid||event.cost!==cost)throw invalid("悔棋扣分记录不合法",409);
  }else if(event.type==="end"){
   if(!terminal||event.result!==terminal||n!==events.length-1)throw invalid("终局结果与棋谱不一致",409);
   seenEnd=true;
  }else throw invalid("未知对局事件",409);
 }
 if(!seenEnd||pendingAI||terminal!==reportedResult||undoCount!==reportedUndoCount)throw invalid("终局棋谱尚未结束或结果不一致",409);
 return {moves,undoCount,result:terminal};
}
async function audit(env,actor,target,action,detail){
 await env.DB.prepare("INSERT INTO admin_audit(id,admin_id,target_id,action,detail) VALUES(?,?,?,?,?)")
 .bind(crypto.randomUUID(),actor,target,action,JSON.stringify(detail)).run();
}
function adminOrThrow(env,user){
 if(!env.ADMIN_USER_ID||user.id!==env.ADMIN_USER_ID)throw invalid("没有管理员权限",403);
}
function corsFor(request,env){
 const origin=request.headers.get("Origin")||"";
 const allowed=(env.FRONTEND_ORIGIN||"https://nkfff.github.io").replace(/\/$/,"");
 const localDev=env.DEV_ORIGIN||"";
 return (origin===allowed||(localDev&&origin===localDev))?
 {"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Vary":"Origin"}:{};
}
export default {
 async fetch(request,env){
  const cors=corsFor(request,env);
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const origin=request.headers.get("Origin");
  if(origin&&!cors["Access-Control-Allow-Origin"])return reply({error:"Origin 不允许"},403,cors);
  const url=new URL(request.url);
  if(url.pathname==="/api/health")return reply({ok:true,version:"2.3",configured:!!env.SUPABASE_URL},200,cors);
  try{
   if(url.pathname==="/api/leaderboard"&&request.method==="GET"){
    const {results}=await env.DB.prepare("WITH base AS (SELECT name,COALESCE(earned_points,0) AS earned_points,wins,losses,draws,(wins+losses+draws) AS games_played,ROUND(100.0*wins/(wins+losses+draws),1) AS win_rate,100.0*(wins+2.5)/(wins+losses+draws+5) AS adjusted_win_rate FROM players WHERE banned=0 AND (wins+losses+draws)>0) SELECT name,earned_points,wins,losses,draws,games_played,win_rate,ROUND(adjusted_win_rate,1) AS adjusted_win_rate,MAX(0,ROUND(earned_points+(adjusted_win_rate-50)*MIN(games_played,20)/10.0)) AS rank_points FROM base ORDER BY rank_points DESC,earned_points DESC,wins DESC,games_played DESC LIMIT 30").all();
    return reply({players:results},200,cors);
   }
   const user=await authenticate(request,env);
   await ensure(env,user);
   if(url.pathname.startsWith("/api/admin/")){
    adminOrThrow(env,user);
    if(url.pathname==="/api/admin/users"&&request.method==="GET"){
     const q=clean(url.searchParams.get("q"));
     const {results}=await env.DB.prepare("SELECT id,name,email,points,earned_points,wins,losses,draws,banned,selected_board,selected_piece FROM players WHERE name LIKE ? OR id LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT 60")
      .bind("%"+q+"%","%"+q+"%","%"+q+"%").all();
     return reply({users:results},200,cors);
    }
    if(url.pathname==="/api/admin/audit"&&request.method==="GET"){
     const {results}=await env.DB.prepare("SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT 80").all();
     return reply({events:results},200,cors);
    }
   }
   if(request.method!=="POST")throw invalid("路径不存在",404);
   if(Number(request.headers.get("Content-Length")||0)>25000)throw invalid("请求过大",413);
   const body=await request.json();
   if(JSON.stringify(body).length>25000)throw invalid("请求过大",413);
   if(url.pathname==="/api/profile")return reply({profile:await profile(env,user.id)},200,cors);
   if(url.pathname==="/api/name"){
    const name=clean(body.name);
    if(name.length<2||/[<>]/.test(name))throw invalid("昵称长度 2–24 且不能包含 HTML");
    await env.DB.prepare("UPDATE players SET name=? WHERE id=?").bind(name,user.id).run();
    return reply({profile:await profile(env,user.id)},200,cors);
   }
   if(url.pathname.startsWith("/api/admin/")){
    adminOrThrow(env,user);
    const target=body.targetId;
    if(!uuid(target))throw invalid("目标账号 ID 无效");
     if(target===user.id&&url.pathname!=="/api/admin/adjust-points")throw invalid("管理员可以调整自己的积分，但不能封禁或重置自己的账号");
    const current=await profile(env,target);
    if(!current)throw invalid("用户不存在",404);
    if(url.pathname==="/api/admin/adjust-points"){
     const delta=body.delta;
     if(!Number.isInteger(delta)||delta===0||Math.abs(delta)>100000)throw invalid("积分改动必须为非零整数，绝对值不超过 100000");
     const result=await env.DB.prepare("UPDATE players SET points=points+? WHERE id=? AND points+?>=0").bind(delta,target,delta).run();
     if(result.meta.changes!==1)throw invalid("余额不足，无法扣除",409);
     await env.DB.prepare("INSERT INTO point_ledger(id,player_id,delta,reason,actor_id,note) VALUES(?,? ,?,'admin_adjust',?,?)")
      .bind(crypto.randomUUID(),target,delta,user.id,clean(body.reason)).run();
     await audit(env,user.id,target,"adjust_points",{delta,reason:clean(body.reason)});
    }else if(url.pathname==="/api/admin/ban"){
     const banned=body.banned===true?1:body.banned===false?0:null;
     if(banned===null)throw invalid("banned 必须为 true/false");
     await env.DB.prepare("UPDATE players SET banned=? WHERE id=?").bind(banned,target).run();
     await audit(env,user.id,target,"set_ban",{banned:!!banned});
    }else if(url.pathname==="/api/admin/reset"){
     // Keep transaction history; reset earned score and cosmetics only after admin confirmation.
     await env.DB.prepare("UPDATE players SET points=0,earned_points=0,wins=0,losses=0,draws=0,inventory='[\"classic\",\"board:classic\",\"piece:classic\"]',selected_board='classic',selected_piece='classic' WHERE id=?").bind(target).run();
     await audit(env,user.id,target,"reset_profile",{reason:clean(body.reason)});
    }else throw invalid("路径不存在",404);
    return reply({ok:true,profile:await profile(env,target)},200,cors);
   }
   const current=await profile(env,user.id);
   if(current.banned)throw invalid("账号已被封禁",403);
   if(url.pathname==="/api/shop"){
    const kind=body.kind;
    const item=body.item;
    if(!["board","piece"].includes(kind)||!Object.hasOwn(kind==="board"?boards:pieces,item))throw invalid("未知皮肤");
    const key=kind+":"+item,price=(kind==="board"?boards:pieces)[item];
    const inventory=current.inventory;
    if(!inventory.includes(key)){
     const update=await env.DB.prepare("UPDATE players SET points=points-?,inventory=json_insert(inventory,'$[#]',?) WHERE id=? AND points>=? AND NOT EXISTS(SELECT 1 FROM json_each(inventory) WHERE value=?)")
      .bind(price,key,user.id,price,key).run();
     if(update.meta.changes!==1)throw invalid("积分不足或皮肤已拥有",409);
     if(price)await env.DB.prepare("INSERT INTO point_ledger(id,player_id,delta,reason,note) VALUES(?,?,?,'skin_purchase',?)").bind(crypto.randomUUID(),user.id,-price,key).run();
    }
    await env.DB.prepare("UPDATE players SET "+(kind==="board"?"selected_board":"selected_piece")+"=? WHERE id=?").bind(item,user.id).run();
    return reply({profile:await profile(env,user.id)},200,cors);
   }
   if(url.pathname==="/api/submit"){
    if(!uuid(body.gameId)||!LEVELS[body.level]||![1,2,3].includes(body.result)||!Number.isInteger(body.undoCount)||body.undoCount<0||body.undoCount>112)throw invalid("对局提交参数不合法");
    const validated=validateSubmittedTimeline(body.events,body.level,body.result,body.undoCount);
    const finalMoves=JSON.stringify(validated.moves),cleanEvents=body.events.map(event=>event.type==="move"?{type:"move",i:event.i,p:event.p}:event.type==="undo"?{type:"undo",removed:event.removed,paid:event.paid,cost:event.cost}:{type:"end",result:event.result}),eventJson=JSON.stringify(cleanEvents);
    const existing=await env.DB.prepare("SELECT player_id,level,moves,status,events,settled_at FROM games WHERE id=?").bind(body.gameId).first();
    if(!existing)throw invalid("云端对局会话不存在，请重试同步",409);
    if(existing.player_id!==user.id)throw invalid("对局 ID 已被使用",409);
    if(existing.level!==body.level)throw invalid("对局难度与会话不一致",409);
    if(existing.status==="finished"&&existing.settled_at&&existing.moves===finalMoves&&existing.events===eventJson)
     return reply({alreadySubmitted:true,profile:await profile(env,user.id)},200,cors);
    if(existing.status!=="active")throw invalid("该对局已结束或状态异常",409);
    const undoCost=Math.max(0,validated.undoCount-3)*10;
    const reward=validated.result===1?award[body.level]:0;
    const netDelta=reward-undoCost;
    const statements=[
     env.DB.prepare("UPDATE games SET moves=?,turn=0,status='finished',revision=revision+1,ended_at=datetime('now'),undo_count=?,events=? WHERE id=? AND player_id=? AND level=? AND status='active' AND (SELECT points FROM players WHERE id=?)>=?")
      .bind(finalMoves,validated.undoCount,eventJson,body.gameId,user.id,body.level,user.id,undoCost),
     env.DB.prepare("UPDATE players SET points=points+?,earned_points=earned_points+?,wins=wins+?,losses=losses+?,draws=draws+? WHERE id=? AND points>=? AND EXISTS(SELECT 1 FROM games WHERE id=? AND player_id=? AND status='finished' AND settled_at IS NULL AND events=? AND moves=?)")
      .bind(netDelta,reward,validated.result===1?1:0,validated.result===2?1:0,validated.result===3?1:0,user.id,undoCost,body.gameId,user.id,eventJson,finalMoves)
    ];
    if(reward>0)statements.push(env.DB.prepare("INSERT INTO point_ledger(id,player_id,delta,reason,note) SELECT ?,?,?,'win_reward',? WHERE EXISTS(SELECT 1 FROM games WHERE id=? AND player_id=? AND status='finished' AND settled_at IS NULL AND events=? AND moves=?)")
      .bind(crypto.randomUUID(),user.id,reward,body.gameId,body.gameId,user.id,eventJson,finalMoves));
    if(undoCost>0)statements.push(env.DB.prepare("INSERT INTO point_ledger(id,player_id,delta,reason,note) SELECT ?,?,?,'paid_undo',? WHERE EXISTS(SELECT 1 FROM games WHERE id=? AND player_id=? AND status='finished' AND settled_at IS NULL AND events=? AND moves=?)")
      .bind(crypto.randomUUID(),user.id,-undoCost,body.gameId,body.gameId,user.id,eventJson,finalMoves));
    statements.push(env.DB.prepare("UPDATE games SET settled_at=datetime('now') WHERE id=? AND player_id=? AND status='finished' AND settled_at IS NULL AND events=? AND moves=?")
      .bind(body.gameId,user.id,eventJson,finalMoves));
    const result=await env.DB.batch(statements);
    if(result[0].meta.changes!==1||result[1].meta.changes!==1||result[result.length-1].meta.changes!==1)
     throw invalid("云端积分不足或成绩已被处理，请重试同步",409);
    return reply({alreadySubmitted:false,profile:await profile(env,user.id)},200,cors);
   }
   if(url.pathname==="/api/start"){
    if(!LEVELS[body.level])throw invalid("未知难度");
    const gameId=body.gameId===undefined?crypto.randomUUID():body.gameId;
    if(!uuid(gameId))throw invalid("对局 ID 不合法");
    await env.DB.prepare("INSERT OR IGNORE INTO games(id,player_id,level,moves,turn,status,revision,started_at) VALUES(?,?,?,'[]',1,'active',0,datetime('now'))")
     .bind(gameId,user.id,body.level).run();
    const session=await env.DB.prepare("SELECT player_id,level,status,revision FROM games WHERE id=?").bind(gameId).first();
    if(!session||session.player_id!==user.id||session.level!==body.level)throw invalid("对局会话冲突",409);
    return reply({gameId,revision:session.revision,status:session.status},200,cors);
   }
   if(!["/api/move","/api/undo","/api/hint"].includes(url.pathname))throw invalid("路径不存在",404);
   if(!uuid(body.gameId)||!Number.isInteger(body.revision))throw invalid("对局 ID 或版本不合法");
   const game=await env.DB.prepare("SELECT * FROM games WHERE id=? AND player_id=?").bind(body.gameId,user.id).first();
   if(!game||game.status!=="active"||game.revision!==body.revision||game.turn!==1)throw invalid("对局状态已变化，请刷新",409);
   const moves=JSONparse(game.moves,[]),b=validMoves(moves);
   if(url.pathname==="/api/hint"){
    const suggestions=rankedMoves(b,1,3).slice(0,3).map((index,n)=>({index,rank:n+1,coord:coord(index)}));
    return reply({suggestions,notice:"仅为搜索候选优先级，并非真实胜率"},200,cors);
   }
   if(url.pathname==="/api/undo"){
    if(moves.length===0)throw invalid("还没有可撤销的落子");
    const count=moves.at(-1).p===2?2:1;
    const paid=game.undo_count>=3,cost=paid?10:0;
    if(paid&&current.points<cost)throw invalid("本局免费悔棋已用尽，余额不足 10 积分",409);
    const trimmed=moves.slice(0,-count);
    const operationId=crypto.randomUUID();
    const event=JSON.stringify({type:"undo",operationId,cost,at:new Date().toISOString(),removed:moves.slice(-count)});
    const update=env.DB.prepare("UPDATE games SET moves=?,undo_count=undo_count+1,revision=revision+1,events=json_insert(events,'$[#]',json(?)) WHERE id=? AND player_id=? AND revision=? AND status='active' AND (undo_count<3 OR (SELECT points FROM players WHERE id=?)>=10)")
     .bind(JSON.stringify(trimmed),event,game.id,user.id,game.revision,user.id);
    let changes;
    if(paid){
     // D1 batch executes statements transactionally: either both payment and undo are persisted or neither.
     const charge=env.DB.prepare("UPDATE players SET points=points-10 WHERE id=? AND points>=10 AND EXISTS(SELECT 1 FROM games WHERE id=? AND revision=? AND undo_count>=4 AND json_extract(events,'$[#-1].operationId')=?)")
      .bind(user.id,game.id,game.revision+1,operationId);
     const ledger=env.DB.prepare("INSERT INTO point_ledger(id,player_id,delta,reason,note) SELECT ?,?,-10,'paid_undo',? WHERE EXISTS(SELECT 1 FROM games WHERE id=? AND revision=? AND undo_count>=4 AND json_extract(events,'$[#-1].operationId')=?)")
      .bind(crypto.randomUUID(),user.id,game.id,game.id,game.revision+1,operationId);
     const result=await env.DB.batch([update,charge,ledger]);
     changes=result[0].meta.changes;
     if(changes!==1||result[1].meta.changes!==1||result[2].meta.changes!==1)throw invalid("支付悔棋操作未完成，请联系管理员核查",409);
    }else{
     const result=await update.run();changes=result.meta.changes;
    }
    if(changes!==1)throw invalid("状态变化或积分不足",409);
    return reply({moves:trimmed,revision:game.revision+1,undoCount:game.undo_count+1,paid,cost,profile:await profile(env,user.id)},200,cors);
   }
   const index=body.index;
   if(!Number.isInteger(index)||index<0||index>=CELLS||b[index])throw invalid("无效落子");
   moves.push({i:index,p:1});b[index]=1;
   let result=winLine(b,index,1).length?1:0,ai=null;
   if(!result&&moves.length===CELLS)result=3;
   if(!result){
    ai=chooseAI(b,game.level);b[ai.index]=2;moves.push({i:ai.index,p:2});
    if(winLine(b,ai.index,2).length)result=2;
    else if(moves.length===CELLS)result=3;
   }
   const updated=await env.DB.prepare("UPDATE games SET moves=?,revision=revision+1,status=?,turn=?,ended_at=CASE WHEN ?=0 THEN NULL ELSE datetime('now') END WHERE id=? AND revision=? AND status='active'")
    .bind(JSON.stringify(moves),result?"finished":"active",result?0:1,result,game.id,game.revision).run();
   if(updated.meta.changes!==1)throw invalid("重复提交落子",409);
   if(result){
    const points=result===1?award[game.level]:0;
    await env.DB.prepare("UPDATE players SET points=points+?,earned_points=earned_points+?,wins=wins+?,losses=losses+?,draws=draws+? WHERE id=?")
     .bind(points,points,result===1?1:0,result===2?1:0,result===3?1:0,user.id).run();
    if(points)await env.DB.prepare("INSERT INTO point_ledger(id,player_id,delta,reason,note) VALUES(?,? ,?,'win_reward',?)")
     .bind(crypto.randomUUID(),user.id,points,game.id).run();
   }
   return reply({moves,revision:game.revision+1,result,ai,profile:result?await profile(env,user.id):null},200,cors);
  }catch(e){return reply({error:e.error||"服务端处理失败"},e.status||500,cors);}
 }
};
