// Optional full-game batch-one browser diagnostic. Two games are not a win-rate estimate.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
(async()=>{
 const root=path.resolve(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(root,'models/model.json'),'utf8'));
 const engine=await import(pathToFileURL(path.resolve(__dirname,'../../v3.4/src/engine.js')).href),rules=await import(pathToFileURL(path.join(root,'src/gunuce-search.js')).href);
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  await page.goto((process.env.GUNUCE_BASE_URL||'http://127.0.0.1:8043')+'/v4.0/?gunuceBackend=wasm');
  const report={modelSha:manifest.sha256,modelId:manifest.modelId,backend:'wasm',simulations:128,opponent:'V3.4 hard',opponentTimeMs:engine.LEVELS.hard.timeMs,note:'One fixed empty-board game per color; diagnostic only, not a statistical win rate.',games:[]};
  const output=process.env.GUNUCE_TEST_OUTPUT||path.join(root,'.test-artifacts');fs.mkdirSync(output,{recursive:true});
  for(const color of [1,2]){
   const board=Array(225).fill(0),game={networkColor:color,moves:[],winner:0,moveSeconds:{network:[],opponent:[]}};
   for(let ply=0;ply<225;ply++){
    const player=ply%2+1,start=Date.now();let action;
    if(player===color){
     const move=await page.evaluate(async ({board,player,last})=>{const {requestGunuce}=await import('./src/gunuce.js');return requestGunuce(board,player,last,{backend:'wasm'})},{board,player,last:game.moves.length?game.moves.at(-1):-1});
     assert.equal(move.modelVersion,manifest.sha256);assert.equal(move.simulations,128);assert.equal(move.backend,'wasm');action=move.index;
    }else{const mapped=board.map(x=>x===0?0:x===player?2:1);action=engine.chooseAI(mapped,'hard',{timeMs:engine.LEVELS.hard.timeMs}).index}
    assert(Number.isInteger(action)&&action>=0&&action<225&&board[action]===0);board[action]=player;game.moves.push(action);game.moveSeconds[player===color?'network':'opponent'].push((Date.now()-start)/1000);
    if(ply%5===0)console.log('browser arena color='+color+' ply='+(ply+1)+' move='+action);
    if(rules.won(board,action,player)){game.winner=player;break}
   }
   report.games.push(game);fs.writeFileSync(path.join(output,'browser-arena-check.json'),JSON.stringify(report,null,2));console.log('browser arena completed color='+color+' winner='+game.winner+' plies='+game.moves.length);
  }
  console.log(JSON.stringify({modelSha:report.modelSha,games:report.games.map(g=>({color:g.networkColor,winner:g.winner,plies:g.moves.length}))}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
