let installation=null;
export function installOfflineCache(){
 if(installation)return installation;
 installation=(async()=>{
  if(!('serviceWorker' in navigator))return null;
  const status=document.getElementById('offlineStatus');
  const hadController=Boolean(navigator.serviceWorker.controller);
  let updatePromptShown=false;
  const offerUpdate=()=>{
   if(!hadController||updatePromptShown)return;
   updatePromptShown=true;
   if(window.confirm('五子棋已更新，刷新页面以加载新版管理员后台和功能？'))window.location.reload();
  };
  navigator.serviceWorker.addEventListener('message',({data})=>{
   if(data?.type==='offline-status'&&status)status.textContent=data.ready?'已就绪，可离线对弈':'Gunuce首次使用需联网加载';
   if(data?.type==='sw-update-ready')offerUpdate();
  });
  navigator.serviceWorker.addEventListener('controllerchange',offerUpdate);
  const base=new URL('../',import.meta.url);
  const registration=await navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname,updateViaCache:'none'});
  registration.update().catch(()=>{});
  const ready=await navigator.serviceWorker.ready;
  if(!navigator.serviceWorker.controller)await new Promise(resolve=>{navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true});setTimeout(resolve,1500)});
  ready.active?.postMessage({type:'offline-status'});
  return registration;
 })().catch(()=>null);
 return installation;
}
export async function waitForOfflineShell(){await Promise.race([installOfflineCache(),new Promise(resolve=>setTimeout(resolve,2500))])}
