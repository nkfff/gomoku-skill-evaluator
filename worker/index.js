import {LEVELS,CELLS,winLine,chooseAI} from "../src/engine.js";

const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers}});
const validId=x=>typeof x==="string"&&/^[0-9a-f-]{36}$/i.test(x);
const skins={classic:0,jade:60,night:150,cherry:260,gold:500};
const award={easy:10,normal:30,hard:80};
function boardFrom(moves){
 const board=Array(CELLS).fill(0);
 for(const m of moves){if(!Number.isInteger(m.i)||m.i<0||m.i>=CELLS||board[m.i])throw Error("Invalid moves");board[m.i]=m.p;}
 return board;
}
const cors=(origin,allowed)=>origin===allowed?{"Access-Control-Allow-Origin":origin,"Vary":"Origin","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}:{};
async function ensurePlayer(env,id,name="匿名棋手"){
 await env.DB.prepare("INSERT OR IGNORE INTO players (id, name, points, wins, losses, draws, inventory, created_at) VALUES (?, ?, 0, 0, 0, 0, ?, datetime('now'))").bind(id,name,JSON.stringify(["classic"])).run();
}
async function getProfile(env,id){
 const p=await env.DB.prepare("SELECT id,name,points,wins,losses,draws,inventory,selected_skin FROM players WHERE id=?").bind(id).first();
 return p?{...p,inventory:JSON.parse(p.inventory)}:null;
}
export default {
 async fetch(request,env){
  const origin=request.headers.get("Origin")||"";
  const allowed=(env.FRONTEND_ORIGIN||"https://nkfff.github.io").replace(/\/$/,"");
  const headers=cors(origin,allowed);
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(origin&&origin!==allowed)return json({error:"Origin not allowed"},403,headers);
  const url=new URL(request.url);
  if(url.pathname==="/api/health")return json({ok:true,version:2},200,headers);
  try{
   if(url.pathname==="/api/leaderboard"&&request.method==="GET"){
    const {results}=await env.DB.prepare("SELECT name,points,wins,losses,draws FROM players ORDER BY points DESC,wins DESC LIMIT 30").all();
    return json({mode:"cloud",players:results},200,headers);
   }
   if(request.method!=="POST")return json({error:"Not found"},404,headers);
   if(Number(request.headers.get("Content-Length")||0)>16000)return json({error:"Payload too large"},413,headers);
   const body=await request.json();
   if(!validId(body.playerId))return json({error:"Invalid playerId"},400,headers);
   const id=body.playerId;
   await ensurePlayer(env,id);
   if(url.pathname==="/api/profile")return json({profile:await getProfile(env,id)},200,headers);
   if(url.pathname==="/api/name"){
    const name=String(body.name||"").trim().slice(0,20);
    if(!name||/[<>]/.test(name))return json({error:"Invalid name"},400,headers);
    await env.DB.prepare("UPDATE players SET name=? WHERE id=?").bind(name,id).run();
    return json({profile:await getProfile(env,id)},200,headers);
   }
   if(url.pathname==="/api/shop"){
    const skin=body.skin;
    if(!(skin in skins))return json({error:"Unknown skin"},400,headers);
    const profile=await getProfile(env,id);
    if(profile.inventory.includes(skin)){
      await env.DB.prepare("UPDATE players SET selected_skin=? WHERE id=?").bind(skin,id).run();
      return json({profile:await getProfile(env,id)},200,headers);
    }
    const cost=skins[skin];
    const result=await env.DB.prepare("UPDATE players SET points=points-?,inventory=json_insert(inventory,'$[#]',?),selected_skin=? WHERE id=? AND points>=? AND NOT EXISTS (SELECT 1 FROM json_each(inventory) WHERE value=?)").bind(cost,skin,skin,id,cost,skin).run();
    if(result.meta.changes!==1)return json({error:"Insufficient points or already owned"},409,headers);
    return json({profile:await getProfile(env,id)},200,headers);
   }
   if(url.pathname==="/api/start"){
    const level=body.level;
    if(!LEVELS[level])return json({error:"Invalid difficulty"},400,headers);
    const session=crypto.randomUUID();
    await env.DB.prepare("INSERT INTO games(id,player_id,level,moves,turn,status,revision,started_at) VALUES(?,?,?,'[]',1,'active',0,datetime('now'))").bind(session,id,level).run();
    return json({gameId:session,revision:0,board:Array(CELLS).fill(0)},200,headers);
   }
   if(url.pathname==="/api/move"){
    if(!validId(body.gameId)||!Number.isInteger(body.revision)||!Number.isInteger(body.index)||body.index<0||body.index>=CELLS)return json({error:"Invalid move"},400,headers);
    const row=await env.DB.prepare("SELECT * FROM games WHERE id=? AND player_id=?").bind(body.gameId,id).first();
    if(!row||row.status!=="active"||row.revision!==body.revision||row.turn!==1)return json({error:"Game state mismatch"},409,headers);
    const moves=JSON.parse(row.moves),board=boardFrom(moves);
    if(board[body.index])return json({error:"Occupied"},409,headers);
    moves.push({i:body.index,p:1});board[body.index]=1;
    let result=winLine(board,body.index,1).length?1:0;
    let ai=null;
    if(!result&&moves.length===CELLS)result=3;
    if(!result){
      ai=chooseAI(board,row.level);board[ai.index]=2;moves.push({i:ai.index,p:2});
      if(winLine(board,ai.index,2).length)result=2;
      else if(moves.length===CELLS)result=3;
    }
    const committed=await env.DB.prepare("UPDATE games SET moves=?,revision=revision+1,status=?,turn=?,ended_at=CASE WHEN ?=0 THEN NULL ELSE datetime('now') END WHERE id=? AND revision=? AND status='active'").bind(JSON.stringify(moves),result?"finished":"active",result?0:1,result,row.id,row.revision).run();
    if(committed.meta.changes!==1)return json({error:"Stale revision"},409,headers);
    if(result){
      const win=result===1;
      const awardPoints=win?award[row.level]:0;
      await env.DB.prepare("UPDATE players SET points=points+?,wins=wins+?,losses=losses+?,draws=draws+? WHERE id=?").bind(awardPoints,win?1:0,result===2?1:0,result===3?1:0,id).run();
    }
    return json({gameId:row.id,moves,revision:row.revision+1,result,reward:result===1?award[row.level]:0,ai:ai?{index:ai.index,reason:ai.reason}:null,profile:result?await getProfile(env,id):null},200,headers);
   }
   return json({error:"Not found"},404,headers);
  }catch(e){return json({error:"Request failed",detail:String(e).slice(0,160)},500,headers);}
 }
};
