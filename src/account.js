// Optional Supabase Auth UI. The worker exclusively verifies JWT and administrator rights.
const $=id=>document.getElementById(id);
const apiBase=()=>String(window.GOMOKU_API_URL||"").replace(/\/$/,"");
const SUPABASE_URL=String(window.GOMOKU_SUPABASE_URL||"").replace(/\/$/,"");
const PUBLISHABLE_KEY=String(window.GOMOKU_SUPABASE_PUBLISHABLE_KEY||"");
let client=null,session=null,ready=false,onChange=()=>{};
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
function showState(){
 $("authForm").hidden=loggedIn();
 $("loggedPanel").hidden=!loggedIn();
 $("accountEmail").textContent=session?.user?.email||"";
 $("logout").disabled=!loggedIn();
 $("adminPanel").hidden=true;
}
async function refresh(){
 showState();
 if(!loggedIn())return;
 try{
  const {profile}=await call("profile");
  if(profile?.isAdmin){$("adminPanel").hidden=false;await searchUsers();}
  $("identityStatus").textContent=profile?.isAdmin?"管理员 · 已验证":"已登录 · 云端账号";
 }catch(e){setMessage(e.message,true);}
}
function adminRow(user){
 const tr=document.createElement("tr");
 for(const value of [user.name+" / "+user.id.slice(0,8),String(user.points),String(user.earned_points),user.banned?"封禁":"正常"]){
  const td=document.createElement("td");td.textContent=value;tr.appendChild(td);
 }
 const td=document.createElement("td"),button=document.createElement("button");
 button.textContent="管理";button.onclick=()=>selectUser(user);
 td.appendChild(button);tr.appendChild(td);return tr;
}
let selectedUser=null;
function selectUser(u){
 selectedUser=u;
 $("selectedUser").textContent=u.name+" ("+u.id+") · 现有积分 "+u.points;
 $("adminActions").hidden=false;
}
async function searchUsers(){
 try{
  const q=encodeURIComponent($("adminSearch").value.trim());
  const res=await call("admin/users?q="+q,null,"GET");
  const tbody=$("adminResults");tbody.replaceChildren();
  for(const u of res.users)tbody.appendChild(adminRow(u));
 }catch(e){setMessage("管理员列表："+e.message,true);}
}
async function adminPost(path,data){
 if(!selectedUser)return;
 const name=selectedUser.name;
 try{
  const result=await call(path,{targetId:selectedUser.id,...data});
  setMessage("已完成 "+name+" 的管理操作，日志已记录");
  selectedUser=result.profile;
  await searchUsers();
  $("selectedUser").textContent=name+" · 最新积分 "+result.profile.points;
 }catch(e){setMessage(e.message,true);}
}
export async function initAccount(onAuthChange){
 onChange=onAuthChange||(()=>{});
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
  client.auth.onAuthStateChange((event,next)=>{
   session=next;
   showState();
   // Avoid requesting Supabase directly inside its auth state callback.
   Promise.resolve().then(()=>onChange(!!session)).catch(()=>{});
  });
  ready=true;
  setMessage(loggedIn()?"已恢复账号登录":"请选择注册或登录；游客对局不会进入云端排行榜。");
  await refresh();
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
   await refresh();
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
$("adminFind").onclick=searchUsers;
$("adminAdjust").onclick=async()=>{
 const delta=Number($("adminDelta").value);
 const reason=$("adminReason").value.trim();
 if(!Number.isInteger(delta)||delta===0||!reason){setMessage("请输入非零整数积分和操作原因",true);return;}
 if(!confirm("确定对 "+selectedUser?.name+" 调整 "+delta+" 积分吗？"))return;
 await adminPost("admin/adjust-points",{delta,reason});
};
$("adminReset").onclick=async()=>{
 const reason=$("adminReason").value.trim();
 if(!reason||!selectedUser){setMessage("请填写重置原因并选择用户",true);return;}
 if(prompt("此操作将清零目标账号积分、战绩、皮肤，请输入 RESET 确认")!=="RESET")return;
 await adminPost("admin/reset",{reason});
};
$("adminBan").onclick=async()=>{
 if(!selectedUser)return;
 const banned=!selectedUser.banned;
 if(!confirm((banned?"封禁":"解除封禁")+"账号 "+selectedUser.name+"？"))return;
 await adminPost("admin/ban",{banned});
};
$("adminAudit").onclick=async()=>{
 try{
  const {events}=await call("admin/audit",null,"GET");
  $("auditHistory").textContent=events.map(e=>e.created_at+" · "+e.action+" · "+e.target_id.slice(0,8)+" · "+e.detail).join("\n")||"暂无记录";
 }catch(e){setMessage(e.message,true);}
};
