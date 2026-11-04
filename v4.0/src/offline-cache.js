let installation=null;
export const UPDATE_PROMPT_KEY="gomoku-sw-update-prompted-version";
export function shouldPromptForUpdate(hadController,version,promptedVersion){return Boolean(hadController&&typeof version==="string"&&version.trim()&&version!==promptedVersion);}
function readPromptedVersion(){try{const v=localStorage.getItem(UPDATE_PROMPT_KEY);if(v)return v;}catch{}try{return sessionStorage.getItem(UPDATE_PROMPT_KEY)||"";}catch{return "";}}
function savePromptedVersion(version){try{localStorage.setItem(UPDATE_PROMPT_KEY,version);return;}catch{}try{sessionStorage.setItem(UPDATE_PROMPT_KEY,version);}catch{}}
export function installOfflineCache(){
 if(installation)return installation;
 installation=(async()=>{
  if(!("serviceWorker" in navigator))return null;
  const status=document.getElementById("offlineStatus"),hadController=Boolean(navigator.serviceWorker.controller),promptedThisPage=new Set();
  const offerUpdate=version=>{const next=String(version||"").trim();if(!shouldPromptForUpdate(hadController,next,readPromptedVersion())||promptedThisPage.has(next))return;promptedThisPage.add(next);savePromptedVersion(next);if(window.confirm("五子棋已更新至新版本（"+next.slice(0,8)+"），是否立即刷新？"))window.location.reload();};
  navigator.serviceWorker.addEventListener("message",({data})=>{if(data?.type==="offline-status"&&status)status.textContent=data.ready?"已就绪，可离线对弈":"Gunuce首次使用需联网加载";if(data?.type==="sw-update-ready")offerUpdate(data.version);});
  const base=new URL("../",import.meta.url),registration=await navigator.serviceWorker.register(new URL("sw.js",base),{scope:base.pathname,updateViaCache:"none"});registration.update().catch(()=>{});
  const ready=await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>{navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true});setTimeout(resolve,1500)});
  ready.active?.postMessage({type:"offline-status"});return registration;
 })().catch(()=>null);return installation;
}
export async function waitForOfflineShell(){await Promise.race([installOfflineCache(),new Promise(resolve=>setTimeout(resolve,2500))])}
