import {createRemoteJWKSet,jwtVerify} from "jose";
import {LEVELS,CELLS,winLine,chooseAI,rankedMoves,coord} from "../src/engine.js";

const award={easy:10,normal:30,hard:80};
const boards={classic:0,jade:60,night:150,cherry:260,gold:500};
const pieces={classic:0,crystal:45,ink:85,neon:140,pearl:220};
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
  if(url.pathname==="/api/health")return reply({ok:true,version:"2.2",configured:!!env.SUPABASE_URL},200,cors);
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
   if(url.pathname==="/api/start"){
    if(!LEVELS[body.level])throw invalid("未知难度");
    const gameId=crypto.randomUUID();
    await env.DB.prepare("INSERT INTO games(id,player_id,level,moves,turn,status,revision,started_at) VALUES(?,?,?,'[]',1,'active',0,datetime('now'))").bind(gameId,user.id,body.level).run();
    return reply({gameId,revision:0},200,cors);
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
