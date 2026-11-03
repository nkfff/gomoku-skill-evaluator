// Optional Supabase Auth UI. The worker exclusively verifies JWT and administrator rights.
const $=id=>document.getElementById(id);
const apiBase=()=>String(window.GOMOKU_API_URL||"").replace(/\/$/,"");
const callbackHash=new URLSearchParams(window.location.hash.replace(/^#/,""));
const callbackQuery=new URLSearchParams(window.location.search);
const authCallbackType=callbackHash.get("type")||callbackQuery.get("type")||"";
const authCallbackError=callbackHash.get("error_description")||callbackQuery.get("error_description")||"";
const hasAuthCallback=!!(callbackHash.get("access_token")||callbackQuery.get("code")||callbackQuery.get("token_hash")||authCallbackError);
const SUPABASE_URL=String(window.GOMOKU_SUPABASE_URL||"").replace(/\/$/,"");
const PUBLISHABLE_KEY=String(window.GOMOKU_SUPABASE_PUBLISHABLE_KEY||"");
let client=null,session=null,ready=false,onChange=()=>{},onProfileChange=()=>{};
export const cloudConfigured=()=>!!(SUPABASE_URL&&PUBLISHABLE_KEY&&apiBase());
export const loggedIn=()=>!!session?.access_token;
export async function bearer(){
 if(!client)return null;
 const {data}=await client.auth.getSession();
 session=data?.session||null;
 return session?.access_token||null;
}
async function call(path,payload=null,method="POST"){
 const token=await bearer();
 if(!token)throw Error("请先登录账号");
 const response=await fetch(apiBase()+"/api/"+path,{
  method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
  ...(method==="POST"?{body:JSON.stringify(payload||{})}: {})
 });
 const value=await response.json();
 if(!response.ok)throw Error(value.error||"服务器请求失败");
 return value;
}
function setMessage(text,bad=false){$("authNotice").textContent=text;$("authNotice").style.color=bad?"#ffc2bb":"#b3e7cc";}
function setGlobalFeedback(text,bad=false){
 const box=$("authFeedback");
 if(!box)return;
 box.textContent=text;
 box.classList.toggle("error",bad);
 box.hidden=false;
}
function showState({resetAdmin=false}={}){
 const signedIn=loggedIn();
 $("authForm").hidden=signedIn;
 $("loggedPanel").hidden=!signedIn;
 $("accountEmail").textContent=session?.user?.email||"";
 $("logout").disabled=!signedIn;
 if(!signedIn||resetAdmin)$("adminPanel").hidden=true;
}
async function refresh(){
 showState();
 if(!loggedIn()){$("adminPanel").hidden=true;return;}
 try{
  const {profile}=await call("profile");
  if(profile){
   const field=$("accountDisplayName");
   if(field)field.value=profile.name||"匿名棋手";
   onProfileChange(profile);
  }
  const isAdmin=profile?.isAdmin===true;
  $("adminPanel").hidden=!isAdmin;
  if(isAdmin)await searchUsers();
  else{
   $("adminResults").replaceChildren();
   $("adminActions").hidden=true;
   $("auditHistory").textContent="";
  }
  $("identityStatus").textContent=isAdmin?"管理员 · 已验证":"已登录 · 云端账号";
 }catch(e){setMessage(e.message,true);}
}
function adminRow(user){
 const tr=document.createElement("tr");
 const games=Number(user.games_played??(Number(user.wins||0)+Number(user.losses||0)+Number(user.draws||0)));
 const rank=user.leaderboard_rank?("第"+user.leaderboard_rank+"名"):"未上榜";
 const values=[user.name+" / "+user.id.slice(0,8),String(user.points),String(user.earned_points),String(user.rank_points||0),String(games),
  String(user.wins||0),Number(user.win_rate||0).toFixed(1)+"%",rank,user.banned?"封禁":"正常"];
 for(const value of values){const td=document.createElement("td");td.textContent=value;tr.appendChild(td);}
 const td=document.createElement("td"),button=document.createElement("button");
 button.type="button";button.textContent="管理";button.onclick=()=>selectUser(user);
 td.appendChild(button);tr.appendChild(td);return tr;
}
let selectedUser=null;
function sqliteRound(value){return Math.sign(value)*Math.floor(Math.abs(value)+0.5);}
function refreshAdminStatsPreview(){
 const preview=$("adminStatsPreview");if(!preview)return;
 if(!selectedUser){preview.textContent="请先选择一个账号。";return;}
 const games=Number($("adminGames").value),wins=Number($("adminWins").value),earned=Number($("adminEarnedPoints").value),draws=Number(selectedUser.draws||0);
 if(!Number.isSafeInteger(games)||games<0||!Number.isSafeInteger(wins)||wins<0||!Number.isSafeInteger(earned)||earned<0||earned>1000000){
  preview.textContent="请输入非负整数；竞技积分上限为 1,000,000。";return;
 }
 if(wins+draws>games){preview.textContent="胜局数 + 当前平局数不能超过总场次。";return;}
 const losses=games-wins-draws,winRate=games?100*wins/games:0,adjustedRate=100*(wins+2.5)/(games+5);
 const rankPoints=games?Math.max(0,sqliteRound(earned+(adjustedRate-50)*Math.min(games,20)/10)):0;
 preview.textContent="预计胜率 "+winRate.toFixed(1)+"% · 胜 "+wins+" / 平 "+draws+" / 负 "+losses+
  " · 排行榜综合积分 "+rankPoints+"（竞技积分基数 "+earned+"）";
}
function selectUser(u){
 selectedUser=u;
 const rank=u.leaderboard_rank?("第"+u.leaderboard_rank+"名"):"未上榜";
 $("selectedUser").textContent=u.name+" ("+u.id+") · 账户余额 "+u.points+" · 综合积分 "+Number(u.rank_points||0)+" · 当前排行榜 "+rank;
 $("adminActions").hidden=false;
 $("adminGames").value=String(u.games_played??(Number(u.wins||0)+Number(u.losses||0)+Number(u.draws||0)));
 $("adminWins").value=String(u.wins||0);
 $("adminEarnedPoints").value=String(u.earned_points||0);
 refreshAdminStatsPreview();
}
async function searchUsers(){
 try{
  const q=encodeURIComponent($("adminSearch").value.trim()),res=await call("admin/users?q="+q,null,"GET");
  const users=Array.isArray(res.users)?res.users:[];
  const tbody=$("adminResults");tbody.replaceChildren();
  for(const u of users)tbody.appendChild(adminRow(u));
  if(selectedUser){const fresh=users.find(user=>user.id===selectedUser.id);if(fresh)selectUser(fresh);}
  return users;
 }catch(e){setMessage("管理员列表："+e.message,true);return [];}
}
async function adminPost(path,data,successMessage,button){
 if(!selectedUser){setMessage("请先查询并选择一个账号",true);return false;}
 const targetId=selectedUser.id,name=selectedUser.name;if(button)button.disabled=true;
 try{
  const result=await call(path,{targetId,...data});
  if(!result?.profile)throw Error("服务器未返回更新后的账号资料");
  selectedUser=result.profile;
  const users=await searchUsers(),fresh=users.find(user=>user.id===targetId);
  if(fresh)selectUser(fresh);
  if(typeof window.gomokuRefreshLeaderboard==="function")await window.gomokuRefreshLeaderboard();
  setMessage(successMessage||("已完成 "+name+" 的管理操作，日志已记录"));return true;
 }catch(e){setMessage("管理操作失败："+e.message,true);return false;}
 finally{if(button)button.disabled=false;}
}
export async function initAccount(onAuthChange,onRemoteProfileChange){
 onChange=onAuthChange||(()=>{});
 onProfileChange=onRemoteProfileChange||(()=>{});
 $("authForm").hidden=false;$("loggedPanel").hidden=true;
 if(!cloudConfigured()){
  setMessage("账号系统尚未连接 Supabase / Cloudflare；可继续游客对弈。需要部署后才能注册和管理。");
  $("authInputs").disabled=true;return;
 }
 try{
  // Dynamic load: the offline game continues even if the auth provider is unavailable.
  const {createClient}=await import("https://esm.sh/@supabase/supabase-js@2");
  client=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const result=await client.auth.getSession();
  session=result.data?.session||null;
  let lastUserId=session?.user?.id||null;
  client.auth.onAuthStateChange((event,next)=>{
   const nextUserId=next?.user?.id||null;
   const identityChanged=nextUserId!==lastUserId;
   session=next;
   // Same-user token refreshes must not hide a server-verified admin panel.
   // Account switches hide it until the new user is checked by the Worker.
   showState({resetAdmin:identityChanged||!nextUserId});
   if(!identityChanged)return;
   lastUserId=nextUserId;
   Promise.resolve().then(async()=>{
    if(nextUserId)await refresh();
    await onChange(!!nextUserId);
   }).catch(()=>{});
  });
  ready=true;
  setMessage(loggedIn()?"已恢复账号登录":"请选择注册或登录；游客对局不会进入云端排行榜。");
  await refresh();
  if(session)await onChange(true);
  if(authCallbackError){
   const message="邮箱验证失败："+authCallbackError;
   setMessage(message,true);setGlobalFeedback(message,true);
  }else if(authCallbackType==="signup"||authCallbackType==="email"||(hasAuthCallback&&authCallbackType!=="recovery")){
   const message=loggedIn()?"邮箱验证成功！账号已激活并自动登录，现在可以开始下棋。":"邮箱验证链接已打开。请进入「账号 / 管理」查看状态；如果未自动登录，请使用注册邮箱登录。";
   setMessage(message,!loggedIn());setGlobalFeedback(message,!loggedIn());
  }
 }catch(e){setMessage("登录模块加载失败："+e.message,true);}
}
async function authTask(task){
 if(!client){setMessage("请先配置认证服务",true);return;}
 try{
  const email=$("authEmail").value.trim(),password=$("authPassword").value;
  if(task==="register"){
   if(password.length<10)throw Error("密码至少 10 位");
   const {error}=await client.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}});
   if(error)throw error;
   setMessage("注册请求已提交。如启用了邮箱验证，请先打开验证邮件再登录。");
  }else if(task==="login"){
   const {error}=await client.auth.signInWithPassword({email,password});
   if(error)throw error;
   setMessage("欢迎回来，账号已登录！");
   // SIGNED_IN triggers the auth-state handler, which refreshes the server-verified role.
  }else if(task==="recover"){
   if(!email)throw Error("请输入邮箱");
   const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
   if(error)throw error;
   setMessage("已发送密码重置请求；如邮箱存在，请查收邮件。");
  }else if(task==="change"){
   const newPassword=$("newPassword").value;
   if(newPassword.length<10)throw Error("新密码至少 10 位");
   const {error}=await client.auth.updateUser({password:newPassword});
   if(error)throw error;
   setMessage("密码已更新");
  }
 }catch(e){setMessage(e.message,true);}
}
$("register").onclick=()=>authTask("register");
$("login").onclick=()=>authTask("login");
$("recover").onclick=()=>authTask("recover");
$("changePassword").onclick=()=>authTask("change");
$("logout").onclick=async()=>{if(!client)return;await client.auth.signOut();session=null;showState();setMessage("已退出账号");await onChange(false);};
$("saveDisplayName").onclick=async()=>{
 const field=$("accountDisplayName"),name=field.value.trim();
 if(name.length<2||name.length>24||/[<>]/.test(name)){setMessage("显示名称需为 2–24 个字符，且不能包含 < 或 >",true);return;}
 const button=$("saveDisplayName");button.disabled=true;
 try{
  const {profile}=await call("name",{name});
  if(!profile)throw Error("服务器未返回账号资料");
  field.value=profile.name||name;
  onProfileChange(profile);
  setMessage("显示名称已保存，并已同步到排行榜。");
 }catch(e){setMessage("保存显示名称失败："+e.message,true);}
 finally{button.disabled=false;}
};
for(const id of ["adminGames","adminWins","adminEarnedPoints"])$(id).addEventListener("input",refreshAdminStatsPreview);
$("adminFind").onclick=searchUsers;
$("adminSaveStats").onclick=async()=>{
 if(!selectedUser){setMessage("请先查询并选择一个账号",true);return;}
 const gamesPlayed=Number($("adminGames").value),wins=Number($("adminWins").value),earnedPoints=Number($("adminEarnedPoints").value);
 const draws=Number(selectedUser.draws||0),reason=$("adminReason").value.trim();
 if(!reason){setMessage("请填写操作原因",true);return;}
 if(!Number.isSafeInteger(gamesPlayed)||gamesPlayed<0||!Number.isSafeInteger(wins)||wins<0||
    !Number.isSafeInteger(earnedPoints)||earnedPoints<0||earnedPoints>1000000||wins+draws>gamesPlayed){
  refreshAdminStatsPreview();setMessage("战绩数据不合法，请检查总场次、胜局数和竞技积分",true);return;
 }
 if(!confirm("确定将 "+selectedUser.name+" 的 AI 战绩调整为 "+gamesPlayed+" 场、"+wins+" 胜，并将竞技积分基数设为 "+earnedPoints+"？"))return;
 await adminPost("admin/adjust-stats",{gamesPlayed,wins,earnedPoints,reason},
  "战绩与竞技积分已保存，胜率、综合积分和排行榜名次已重新计算。",$("adminSaveStats"));
};
$("adminAdjust").onclick=async()=>{
 if(!selectedUser){setMessage("请先选择账号",true);return;}
 const delta=Number($("adminDelta").value),reason=$("adminReason").value.trim();
 if(!Number.isInteger(delta)||delta===0||!reason){setMessage("请输入非零整数账户余额调整值和操作原因",true);return;}
 if(!confirm("确定对 "+selectedUser.name+" 调整账户余额 "+delta+" 积分吗？此操作不影响排行榜。"))return;
 await adminPost("admin/adjust-points",{delta,reason},"账户余额已调整；该余额不参与排行榜。",$("adminAdjust"));
};
$("adminReset").onclick=async()=>{
 const reason=$("adminReason").value.trim();
 if(!reason||!selectedUser){setMessage("请填写清空原因并选择用户",true);return;}
 const confirmation=prompt("将清空 "+selectedUser.name+" 的全部 AI 对局记录、胜负战绩和竞技积分；账户皮肤与真人 PVP/Elo 记录保留。请输入 CLEAR 确认");
 if(confirmation!=="CLEAR"){setMessage("已取消清空操作。");return;}
 await adminPost("admin/reset",{reason},"AI 对局记录、胜负战绩和竞技积分已清空；账户皮肤及真人 PVP/Elo 记录保留。",$("adminReset"));
};
$("adminBan").onclick=async()=>{
 if(!selectedUser){setMessage("请先选择账号",true);return;}
 const banned=!selectedUser.banned;
 if(!confirm((banned?"封禁":"解除封禁")+"账号 "+selectedUser.name+"？"))return;
 await adminPost("admin/ban",{banned},banned?"账号已封禁。":"账号已解除封禁。",$("adminBan"));
};
$("adminAudit").onclick=async()=>{
 try{
  const {events}=await call("admin/audit",null,"GET");
  $("auditHistory").textContent=events.map(e=>e.created_at+" · "+e.action+" · "+e.target_id.slice(0,8)+" · "+e.detail).join("\n")||"暂无记录";
 }catch(e){setMessage(e.message,true);}
};
