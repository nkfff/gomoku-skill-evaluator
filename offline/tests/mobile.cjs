const {chromium}=require("../../v4.0/browser-tests/node_modules/playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 const page=await context.newPage(),errors=[],remote=[];\n await page.addInitScript(()=>Object.defineProperty(navigator,"onLine",{configurable:true,get:()=>false}));
 const base=process.env.OFFLINE_BASE_URL||"http://127.0.0.1:8043/offline/dist/";
 page.on("pageerror",e=>errors.push(e.message));
 page.on("request",r=>{const host=new URL(r.url()).hostname;if(!["127.0.0.1","localhost"].includes(host))remote.push(r.url());});
 await context.route("**/*",route=>["127.0.0.1","localhost"].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.goto(base);
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});
  const state=await page.evaluate(()=>({
   overflow:document.documentElement.scrollWidth-window.innerWidth,
   board:document.getElementById("board").getBoundingClientRect().width,
   hiddenPvp:getComputedStyle(document.getElementById("tab-pvp")).display==="none",\n   replayVisible:getComputedStyle(document.getElementById("tab-replay")).display!=="none",
   nav:[...document.querySelectorAll(".tabs button")].filter(b=>getComputedStyle(b).display!=="none").length
  }));
  assert(state.overflow<=1,"Horizontal overflow at "+width+"px: "+JSON.stringify(state));
  assert(state.board<=width,"Board clipped at "+width+"px");
  assert(!state.hiddenPvp,"PVP tab must remain available in hybrid app");
  if(width<720)assert.equal(state.nav,4,"Four primary navigation tabs required on mobile");
 }
 await page.setViewportSize({width:390,height:844});
 await page.locator("#startGame").click();
 const board=page.locator("#board"),box=await board.boundingBox();
 assert(box&&box.width>250,"board must be easily touchable");
 await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
 await page.waitForFunction(()=>document.querySelectorAll("#history .move").length>=1);
 await page.locator("#tab-replay").click();\n assert(await page.locator("#panel-replay").isVisible(),"AI review panel unavailable");\n assert(await page.locator("#reviewOnlineSearch").isVisible(),"Online AI coach button must remain visible");\n assert(await page.locator("#reviewOnlineSearch").isDisabled(),"Online AI coach must be disabled while offline and logged out");\n await page.locator("#tab-pvp").click();\n assert(await page.locator("#panel-pvp").isVisible(),"PVP panel unavailable");\n assert.match(await page.locator("#pvpNotice").textContent(),/离线/);\n await page.locator("#tab-account").click();\n assert(await page.locator("#panel-account").isVisible(),"account panel unavailable");\n await page.locator("#tab-puzzle").click();
 assert(await page.locator("#panel-puzzle").isVisible(),"puzzle panel unavailable");
 await page.getByRole("button",{name:"🎲 随机连珠"}).first().click();
 assert(await page.locator("#panel-random").isVisible(),"random mode unavailable");
 await page.locator("#tab-leaderboard").click();
 assert(await page.locator("#panel-leaderboard").isVisible(),"local records unavailable");
 await page.waitForFunction(()=>document.querySelector("#offlineStatus")?.textContent.includes("可断网"),null,{timeout:120000});
 await context.setOffline(true);
 await page.reload();
 assert(await page.locator("#startGame").isVisible(),"Offline restart failed");
 await page.locator("#startGame").click();
 assert.match(await page.locator("#status").textContent(),/轮到你|AI 思考|开始/);
 const dir=path.resolve(__dirname,"../.test-artifacts");fs.mkdirSync(dir,{recursive:true});
 await page.screenshot({path:path.join(dir,"offline-mobile-390.png"),fullPage:true});
 assert.equal(remote.length,0,"Standalone offline game requested external domains: "+remote.join(", "));
 assert.equal(errors.length,0,errors.join("\n"));
 console.log("Hybrid mobile navigation, AI review visibility and airplane-mode smoke test passed");
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
