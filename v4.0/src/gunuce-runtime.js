// All URLs are same-origin, relative to this deployed version, never a CDN/API.
import {Node,search,validatePosition} from './gunuce-search.js';
let loaded=null;
async function sha256(bytes){if(!globalThis.crypto?.subtle)throw Error('请通过HTTPS或本机预览打开Gunuce');return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function loadRuntime({backend='auto',onProgress=()=>{}}={}){
 if(loaded)return loaded;
 loaded=(async()=>{
  onProgress({stage:'loading',message:'正在加载 Gunuce（首次使用需要下载本地资源）'});
  const manifestURL=new URL('../models/model.json',import.meta.url),manifestResponse=await fetch(manifestURL);
  if(!manifestResponse.ok)throw Error('本地模型资源尚未准备好');const manifest=await manifestResponse.json();
  const response=await fetch(new URL(manifest.file,manifestURL));if(!response.ok)throw Error('Gunuce模型下载失败');const bytes=await response.arrayBuffer();
  if(await sha256(bytes)!==manifest.sha256)throw Error('Gunuce模型校验失败，请联网刷新重试');
  let adapter=null,fallback=null;
  if(backend!=='wasm'&&globalThis.navigator?.gpu){try{adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'})}catch(error){fallback=String(error.message||error)}}
  if(adapter&&backend!=='webgpu'){const info=adapter.info||{};if(adapter.isFallbackAdapter||info.isFallbackAdapter||/swiftshader|llvmpipe|software/i.test([info.description,info.architecture,info.device].join(' '))){adapter=null;fallback='Software GPU: using WASM'}}
  const ort=adapter?await import('../vendor/ort/ort.webgpu.min.mjs'):await import('../vendor/ort/ort.wasm.min.mjs');
  ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=new URL('../vendor/ort/',import.meta.url).href;ort.env.wasm.proxy=false;
  let session,provider='wasm';
  if(adapter){try{ort.env.webgpu.adapter=adapter;session=await ort.InferenceSession.create(bytes,{executionProviders:['webgpu'],graphOptimizationLevel:'all'});provider='webgpu'}catch(error){fallback=String(error.message||error)}}
  if(!session)session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
  async function infer(state){const tensor=new ort.Tensor('float32',state,[1,4,15,15]);let outputs;try{outputs=await session.run({state:tensor});return {policy:Float32Array.from(outputs.policy.data),value:Number(outputs.value.data[0])}}finally{tensor.dispose?.();if(outputs)for(const t of Object.values(outputs))t.dispose?.()}}
  // Warm once outside recorded search latency, without mutating the actual game.
  await infer(new Float32Array(900));onProgress({stage:'ready',message:'Gunuce已就绪',backend:provider});
  return {manifest,provider,fallback,infer};
 })().catch(error=>{loaded=null;throw error});return loaded;
}
export async function chooseLocal(board,player,last,{backend='auto',onProgress=()=>{},isCancelled=()=>false,simulations=128}={}){
 validatePosition(board,player,last);const runtime=await loadRuntime({backend,onProgress});if(isCancelled())throw Error('Gunuce任务已取消');const started=performance.now(),root=new Node(board,player,last);
 const result=await search(root,runtime.infer,{simulations,fpuReduction:runtime.manifest.search?.fpuReduction??.2,isCancelled,onProgress:(completed,total)=>onProgress({stage:'search',completed,total,message:'Gunuce正在思考（'+completed+'/'+total+'）'})});
 function tree(node){let nodes=1,depth=0;for(const child of node.children.values()){const info=tree(child);nodes+=info.nodes;depth=Math.max(depth,info.depth+1)}return {nodes,depth}}
 return {index:result.index,reason:'Gunuce',...tree(root),simulations:result.simulations,elapsedMs:performance.now()-started,backend:runtime.provider,modelVersion:runtime.manifest.sha256,version:runtime.manifest.version,local:true};
}
