// Bundled native resources work without a Service Worker.
let installation=null;
const KEY="gomoku-offline-update-seen";
const status=()=>document.getElementById("offlineStatus");
function nativeApp(){return location.protocol==="capacitor:"||location.protocol==="gomoku:"||globalThis.Capacitor?.isNativePlatform?.()===true;}
export function installOfflineCache(){
 if(installation)return installation;
 installation=(async()=>{
  if(nativeApp()){if(status())status().textContent="资源已内置 · 可离线对弈";return null;}
  if(!("serviceWorker" in navigator))return null;
  const hadController=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("message",({data})=>{
   if(data?.type==="offline-status"&&status())status().textContent=data.ready?"已就绪 · 可断网使用":"正在准备离线资源…";
   if(data?.type==="sw-update-ready"&&hadController){
    const version=String(data.version||"");
    if(!version||localStorage.getItem(KEY)===version)return;
    localStorage.setItem(KEY,version);
    if(window.confirm("猫猫棋局离线版已更新，是否现在加载新版本？"))location.reload();
   }
  });
  const base=new URL("../",import.meta.url);
  const registration=await navigator.serviceWorker.register(new URL("sw.js",base),{scope:base.pathname,updateViaCache:"none"});
  registration.update().catch(()=>{});
  await navigator.serviceWorker.ready;
  registration.active?.postMessage({type:"offline-status"});
  return registration;
 })().catch(error=>{console.warn("Offline cache unavailable",error);return null;});
 return installation;
}
export async function waitForOfflineShell(){await installOfflineCache();}
