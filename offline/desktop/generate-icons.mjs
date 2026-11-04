// Cross-platform SVG -> PNG / Windows ICO / macOS ICNS. Source is shared with PWA and mobile.
import {createRequire} from "node:module";
import {mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
const require=createRequire(import.meta.url);
const {Resvg}=require("@resvg/resvg-js");
const here=fileURLToPath(new URL(".",import.meta.url)),root=path.resolve(here,"..");
const svg=readFileSync(path.join(root,"icons/cat-gomoku.svg"),"utf8");
const dest=path.join(root,"dist/icons"),assets=path.join(root,"assets");
mkdirSync(dest,{recursive:true});mkdirSync(assets,{recursive:true});
const render=size=>new Resvg(svg,{fitTo:{mode:"width",value:size}}).render().asPng();
for(const size of [192,512,1024])writeFileSync(path.join(dest,"icon-"+size+".png"),render(size));
writeFileSync(path.join(assets,"icon.png"),readFileSync(path.join(dest,"icon-1024.png")));

// An ICO is a directory of PNG-encoded images (Windows Vista+).
const sizes=[16,24,32,48,64,128,256],images=sizes.map(render);
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
sizes.forEach((size,i)=>{
 const pos=6+16*i,buf=images[i];
 header.writeUInt8(size===256?0:size,pos);
 header.writeUInt8(size===256?0:size,pos+1);
 header.writeUInt16LE(1,pos+4);header.writeUInt16LE(32,pos+6);
 header.writeUInt32LE(buf.length,pos+8);header.writeUInt32LE(offset,pos+12);
 offset+=buf.length;
});
writeFileSync(path.join(assets,"icon.ico"),Buffer.concat([header,...images]));
if(process.platform==="darwin"){
 const set=path.join(assets,"cat-gomoku.iconset");
 rmSync(set,{recursive:true,force:true});mkdirSync(set,{recursive:true});
 for(const size of [16,32,128,256,512]){
  for(const scale of [1,2]){
   const file="icon_"+size+"x"+size+(scale===2?"@2x":"")+".png";
   writeFileSync(path.join(set,file),render(size*scale));
  }
 }
 execFileSync("iconutil",["-c","icns","-o",path.join(assets,"icon.icns"),set],{stdio:"inherit"});
 rmSync(set,{recursive:true,force:true});
}
console.log("Generated desktop PWA PNG, Windows ICO"+(process.platform==="darwin"?", macOS ICNS":""));
