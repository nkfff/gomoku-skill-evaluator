import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requestGunuce,cancelGunuce} from '../src/gunuce.js';
let fake;
function factory(){fake={postMessage(message){this.messages.push(message)},messages:[],terminate(){}};return fake}
test('Gunuce uses a local Worker, validates the result and preserves input',async()=>{
 const board=Array(225).fill(0),before=board.slice(),result=requestGunuce(board,1,-1,{workerFactory:factory});const message=fake.messages[0];assert.equal(message.type,'move');assert.equal(message.player,1);assert.equal(message.last,-1);fake.onmessage({data:{requestId:message.requestId,type:'result',result:{index:112,local:true}}});assert.equal((await result).index,112);assert.deepEqual(board,before);
});
test('Gunuce propagates local engine errors and supports cancellation',async()=>{
 const result=requestGunuce(Array(225).fill(0),1,-1,{workerFactory:factory});const id=fake.messages.at(-1).requestId;fake.onmessage({data:{requestId:id,error:'资源未加载'}});await assert.rejects(result,/资源/);
 const cancelled=requestGunuce(Array(225).fill(0),1,-1,{workerFactory:factory});cancelGunuce();await assert.rejects(cancelled,/取消/);assert.equal(fake.messages.at(-1).type,'cancel');
});
test('Gunuce release wiring has no inference endpoint and displays the Gunuce win reward',()=>{
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8'),html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),client=readFileSync(new URL('../src/gunuce.js',import.meta.url),'utf8');
 assert.match(html,/V4\.0\.12/);assert.match(html,/<option value="gunuce">Gunuce · 胜 \+400<\/option>/);assert.doesNotMatch(html,/不计积分/);assert.doesNotMatch(app,/不计积分/);assert.match(html,/id="retryAI"/);assert.match(app,/game\.cloudSession=cloudMode\(\)/);assert.match(app,/game\.aiError=error\.message/);assert.doesNotMatch(client,/api\/gunuce|fetch\(/);assert.match(client,/new Worker/);
});

test('service worker activates new releases and prompts existing tabs to refresh',()=>{
 const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 const cache=readFileSync(new URL('../src/offline-cache.js',import.meta.url),'utf8');
 assert.match(sw,/await self\.skipWaiting\(\)/);
 assert.match(sw,/await self\.clients\.claim\(\)/);
 assert.match(sw,/sw-update-ready/);
 assert.match(cache,/updateViaCache:\s*['"]none['"]/);
 assert.match(cache,/controllerchange/);
 assert.match(cache,/location\.reload\(\)/);
});
