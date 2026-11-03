import {waitForOfflineShell} from './offline-cache.js';
// Dedicated local Worker; no inference HTTP endpoint, auth token or server fallback.
let worker=null,nextId=0,cancellationEpoch=0;const pending=new Map();
function ensureWorker(factory){
 if(worker)return worker;
 if(!factory&&typeof Worker==='undefined')throw Error('当前浏览器不支持Gunuce，请使用较新的浏览器');
 worker=factory?factory():new Worker(new URL('./gunuce.worker.js',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{
  const request=pending.get(data.requestId);if(!request)return;
  if(data.type==='progress'){request.onProgress?.(data);return}
  pending.delete(data.requestId);clearTimeout(request.timer);
  if(data.error)request.reject(Error(data.error));
  else if(!data.result||!Number.isInteger(data.result.index)||data.result.index<0||data.result.index>=225||request.board[data.result.index])request.reject(Error('Gunuce返回了非法落点'));
  else request.resolve(data.result);
 };
 worker.onerror=()=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Gunuce本地引擎暂不可用，请重试'))}pending.clear();worker?.terminate();worker=null};return worker;
}
export async function requestGunuce(board,player,last,{onProgress,backend,timeoutMs=180000,workerFactory}={}){
 const epoch=cancellationEpoch;
 try{
  if(typeof navigator!=='undefined'&&!workerFactory)await waitForOfflineShell();
  if(epoch!==cancellationEpoch)throw Error('Gunuce任务已取消');
  const engine=ensureWorker(workerFactory),requestId=++nextId;
  const selected=backend||((typeof location!=='undefined'&&new URL(location.href).searchParams.get('gunuceBackend'))||'auto');
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(requestId);engine.postMessage({type:'cancel',requestId});reject(Error('Gunuce准备或思考超时，请重试'))},timeoutMs);
   pending.set(requestId,{resolve,reject,timer,onProgress,board:board.slice()});engine.postMessage({type:'move',requestId,board:board.slice(),player,last,backend:selected});
  });
 }catch(error){return Promise.reject(error)}
}
export function cancelGunuce(){cancellationEpoch++;for(const [requestId,request] of pending){clearTimeout(request.timer);worker?.postMessage({type:'cancel',requestId});request.reject(Error('Gunuce任务已取消'))}pending.clear()}
