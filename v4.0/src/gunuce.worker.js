import {chooseLocal} from './gunuce-runtime.js';
const cancelled=new Set(),active=new Set();let chain=Promise.resolve();
self.onmessage=({data})=>{
 if(data.type==='cancel'){if(active.has(data.requestId))cancelled.add(data.requestId);return}
 if(data.type!=='move')return;
 const {requestId,board,player,last,backend}=data;active.add(requestId);
 chain=chain.then(async()=>{
  try{
   if(cancelled.has(requestId))return;
   const result=await chooseLocal(board,player,last,{backend,onProgress:progress=>self.postMessage({requestId,type:'progress',...progress}),isCancelled:()=>cancelled.has(requestId)});
   if(!cancelled.has(requestId))self.postMessage({requestId,type:'result',result});
  }catch(error){if(!cancelled.has(requestId))self.postMessage({requestId,type:'error',error:error.message||String(error)})}
  finally{cancelled.delete(requestId);active.delete(requestId)}
 });
};
