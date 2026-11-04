import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gameReward,isRewardLevel} from '../src/rewards.js';
import {validateSubmittedTimeline} from '../worker/index.js';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/gunuce-settlement.json',import.meta.url)));
const events=(moves,result)=>[...moves.map((i,n)=>({type:'move',i,p:n%2+1})),{type:'end',result}];
test('shared rewards preserve existing tiers and award Gunuce 400 / 0 / 2000',()=>{
 for(const [level,win] of [['easy',10],['normal',30],['hard',80],['gunuce',400]]){
  assert.equal(gameReward(level,1),win);assert.equal(gameReward(level,2),0);assert.equal(gameReward(level,3),win*5);
 }
 for(const level of ['__proto__','constructor','unknown']){assert.equal(isRewardLevel(level),false);assert.throws(()=>gameReward(level,1));}
 assert.throws(()=>gameReward('gunuce',4));
});
for(const fixture of fixtures)for(const color of [1,2])test(`Gunuce settles a complete ${fixture.winner?'win':'225-move draw'} with player color ${color}`,()=>{
 const result=fixture.winner===0?3:fixture.winner===color?1:2;
 const validated=validateSubmittedTimeline(events(fixture.moves,result),'gunuce',result,0,color);
 assert.equal(validated.result,result);assert.equal(validated.moves.length,fixture.moves.length);
 assert.equal(gameReward('gunuce',validated.result),result===1?400:result===3?2000:0);
 assert.throws(()=>validateSubmittedTimeline(events(fixture.moves,result),'gunuce',result===1?2:1,0,color));
 assert.throws(()=>validateSubmittedTimeline(events(fixture.moves,result),'gunuce',result,1,color));
});
test('Gunuce rejects a missed forced block and a missed immediate win',()=>{
 const block=[0,224,1,222,2,220,3,218];
 assert.throws(()=>validateSubmittedTimeline(events(block,1),'gunuce',1,0,1),e=>/唯一直接威胁/.test(e.error));
 const win=[224,0,222,1,220,2,218,3,216,6];
 assert.throws(()=>validateSubmittedTimeline(events(win,2),'gunuce',2,0,1),e=>/必胜落子/.test(e.error));
});
