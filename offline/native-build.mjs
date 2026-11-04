import {existsSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root=fileURLToPath(new URL(".",import.meta.url));
const platform=process.argv[2];
if(!["android","ios"].includes(platform)){
 console.error("Usage: npm run native:android | npm run native:ios");
 process.exit(2);
}
if(platform==="ios"&&process.platform!=="darwin"){
 console.error("iOS native project requires macOS and Xcode.");
 process.exit(2);
}
const run=(command,args)=>execFileSync(command,args,{cwd:root,stdio:"inherit",shell:process.platform==="win32"});
run("npm",["run","build"]);
if(!existsSync(path.join(root,platform)))run("npx",["cap","add",platform]);
run("npx",["cap","sync",platform]);
run("npx",["capacitor-assets","generate","--"+platform,"--iconBackgroundColor","#FFF7ED","--splashBackgroundColor","#FFF7ED"]);
console.log("Native project updated: "+path.join(root,platform));
