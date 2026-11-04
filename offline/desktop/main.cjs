const {app,BrowserWindow,protocol,shell,session}=require("electron");
const fs=require("node:fs/promises");
const path=require("node:path");

const SCHEME="gomoku";
const CONTENT_TYPES={
 ".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",
 ".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",
 ".webmanifest":"application/manifest+json; charset=utf-8",".wasm":"application/wasm",
 ".onnx":"application/octet-stream",".png":"image/png",".svg":"image/svg+xml",
 ".ico":"image/x-icon",".txt":"text/plain; charset=utf-8",".md":"text/plain; charset=utf-8"
};
protocol.registerSchemesAsPrivileged([{scheme:SCHEME,privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true,codeCache:true}}]);

const folder=app.isPackaged?path.join(process.resourcesPath,"web"):path.resolve(__dirname,"../dist");
async function serve(request){
 const url=new URL(request.url);
 if(url.hostname!=="app")return new Response("Unknown app origin",{status:404});
 let pathname;
 try{pathname=decodeURIComponent(url.pathname).replace(/^\/+/,"")||"index.html";}catch{return new Response("Invalid path",{status:400});}
 if(pathname.includes("\0"))return new Response("Invalid path",{status:400});
 const file=path.resolve(folder,pathname),root=path.resolve(folder);
 if(file!==root&&!file.startsWith(root+path.sep))return new Response("Forbidden",{status:403});
 try{
  const data=await fs.readFile(file);
  const type=CONTENT_TYPES[path.extname(file).toLowerCase()]||"application/octet-stream";
  return new Response(data,{status:200,headers:{"Content-Type":type,"X-Content-Type-Options":"nosniff"}});
 }catch(e){return new Response(e.code==="ENOENT"?"Not Found":"File error",{status:e.code==="ENOENT"?404:500});}
}
async function createWindow(){
 const win=new BrowserWindow({
  width:1100,height:820,minWidth:360,minHeight:600,backgroundColor:"#fff9f3",
  autoHideMenuBar:true,show:false,
  webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}
 });
 win.once("ready-to-show",()=>win.show());
 win.webContents.setWindowOpenHandler(({url})=>{
  if(url.startsWith("https://github.com/nkfff/gomoku-skill-evaluator"))shell.openExternal(url);
  return {action:"deny"};
 });
 win.webContents.on("will-navigate",(event,url)=>{if(!url.startsWith("gomoku://app/"))event.preventDefault();});
 await win.loadURL("gomoku://app/index.html");
}
app.whenReady().then(async()=>{
 protocol.handle(SCHEME,serve);
 session.defaultSession.setPermissionRequestHandler((_web,_permission,reply)=>reply(false));
 await createWindow();
 app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
}).catch(error=>{console.error(error);app.quit();});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});
