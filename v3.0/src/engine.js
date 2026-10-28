// Shared, deterministic game rules and computer engine (browser + Worker).
export const SIZE = 15;
export const CELLS = SIZE * SIZE;
export const LEVELS = {
  easy:   {label:"新手",reward:10,depth:0,width:6},
  normal: {label:"进阶",reward:30,depth:1,width:6},
  hard:   {label:"大师",reward:80,depth:2,width:7}
};
export const inside = (r,c)=>r>=0&&r<15&&c>=0&&c<15;
export const spot = (r,c)=>r*15+c;
export const coord = i=>"ABCDEFGHIJKLMNO"[i%15]+String(Math.floor(i/15)+1);
const DIRS = [[0,1],[1,0],[1,1],[1,-1]];
export function winLine(b,i,p){
  const r=Math.floor(i/15),c=i%15;
  for(const [dr,dc] of DIRS){
    const cells=[i];
    for(const sign of [-1,1]){
      let y=r+dr*sign,x=c+dc*sign;
      while(inside(y,x)&&b[spot(y,x)]===p){cells.push(spot(y,x));y+=dr*sign;x+=dc*sign;}
    }
    if(cells.length>=5)return cells;
  }
  return [];
}
export function candidates(b,radius=2){
  const s=new Set();
  for(let i=0;i<CELLS;i++)if(b[i]){
    const r=Math.floor(i/15),c=i%15;
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
      if(inside(r+dy,c+dx)){const j=spot(r+dy,c+dx);if(!b[j])s.add(j);}
    }
  }
  return s.size?[...s]:[112];
}
export function immediateWins(b,p,possible=candidates(b)){
  const out=[];
  for(const i of possible){
    if(b[i])continue;
    b[i]=p;
    if(winLine(b,i,p).length)out.push(i);
    b[i]=0;
  }
  return out;
}
export function pointShape(b,i,p){
  if(b[i])return {score:-Infinity,kind:"occupied"};
  let score=0,threes=0,fours=0,open4=0;
  const r=Math.floor(i/15),c=i%15;
  for(const [dy,dx] of DIRS){
    let s="";
    for(let k=-5;k<=5;k++){
      const y=r+dy*k,x=c+dx*k;
      const v=k===0?p:inside(y,x)?b[spot(y,x)]:-1;
      s+=v===p?"X":v===0?".":"O";
    }
    let type=0;
    if(s.includes("XXXXX"))return {score:100000000,kind:"win"};
    if(s.includes(".XXXX.")){type=3500000;open4++;fours++;}
    else if(["XXXX.",".XXXX","XXX.X","XX.XX","X.XXX"].some(x=>s.includes(x))){type=90000;fours++;}
    else if([".XXX.",".XX.X.",".X.XX."].some(x=>s.includes(x))){type=24000;threes++;}
    else if(["XXX.",".XXX","XX.X","X.XX"].some(x=>s.includes(x)))type=2300;
    else if([".XX.",".X.X."].some(x=>s.includes(x)))type=800;
    else type=24;
    score+=type;
  }
  if(fours>=2)score+=4500000;
  if(fours&&threes)score+=2700000;
  if(threes>=2)score+=180000;
  return {score,threes,fours,open4,kind:open4?"活四":fours>=2?"双四":fours?"冲四":threes>=2?"双活三":threes?"活三":"普通"};
}
export function pointValue(b,i,p){
  const own=pointShape(b,i,p).score;
  const block=pointShape(b,i,3-p).score;
  const r=Math.floor(i/15),c=i%15;
  return own*1.12+block*0.99+(14-Math.abs(r-7)-Math.abs(c-7))*0.5;
}
export function rankedMoves(b,p,width=8){
  const possible=candidates(b);
  const wins=immediateWins(b,p,possible);
  if(wins.length)return wins;
  const threats=immediateWins(b,3-p,possible);
  if(threats.length)return threats;
  return possible.sort((a,z)=>pointValue(b,z,p)-pointValue(b,a,p)||a-z).slice(0,width);
}
function estimate(b,p){
  const cand=candidates(b);
  let a=0,aa=0,d=0,dd=0;
  for(const i of cand){
    const x=pointShape(b,i,p).score,y=pointShape(b,i,3-p).score;
    if(x>a){aa=a;a=x;}else if(x>aa)aa=x;
    if(y>d){dd=d;d=y;}else if(y>dd)dd=y;
  }
  return a*1.16+aa*.22-d*1.18-dd*.21;
}
function negamax(b,p,depth,alpha,beta,limit,visits,ply){
  if(++visits.count>=limit||depth===0)return estimate(b,p);
  const options=rankedMoves(b,p,depth>=2?7:6);
  let best=-Infinity;
  for(const i of options){
    b[i]=p;
    const val=winLine(b,i,p).length?1e10-ply:-negamax(b,3-p,depth-1,-beta,-alpha,limit,visits,ply+1);
    b[i]=0;
    if(val>best)best=val;
    alpha=Math.max(alpha,val);
    if(alpha>=beta||visits.count>=limit)break;
  }
  return best;
}
export function chooseAI(b,level="normal"){
  const cfg=LEVELS[level]||LEVELS.normal;
  const possible=candidates(b);
  const wins=immediateWins(b,2,possible);
  if(wins.length)return {index:wins[0],reason:"直接成五",nodes:0};
  const blocks=immediateWins(b,1,possible);
  if(blocks.length)return {index:blocks[0],reason:"紧急堵五",nodes:0};
  const options=rankedMoves(b,2,cfg.width);
  if(!cfg.depth||options.length===1)return {index:options[0],reason:"棋形判断",nodes:0};
  const visits={count:0};
  let best=-Infinity,index=options[0];
  for(const i of options){
    b[i]=2;
    const value=winLine(b,i,2).length?1e10:-negamax(b,1,cfg.depth,-Infinity,Infinity,level==="hard"?2200:550,visits,1);
    b[i]=0;
    if(value>best){best=value;index=i;}
    if(visits.count>=(level==="hard"?2200:550))break;
  }
  return {index,reason:"Alpha-Beta 搜索",nodes:visits.count};
}
export function advice(b,p,played,level="hard"){
  const options=rankedMoves(b,p,5);
  const immediate=immediateWins(b,p);
  const enemy=immediateWins(b,3-p);
  let category="合理";
  if(immediate.length)category=immediate.includes(played)?"抓住必胜点":"漏杀：有直接成五点";
  else if(enemy.length)category=enemy.includes(played)?"及时防住对方成五":"漏防：对手下一手可成五";
  else{
    const shape=pointShape(b,played,p);
    if(shape.kind!=="普通")category=shape.kind;
    else if(!options.includes(played))category="非优先候选（启发式）";
  }
  return {category,best:options[0]??null,alternatives:options.slice(0,3),rank:options.indexOf(played)+1};
}
export function replay(moves){
  const b=Array(CELLS).fill(0),frames=[b.slice()];
  for(const m of moves){
    if(!Number.isInteger(m.i)||m.i<0||m.i>=CELLS||b[m.i]||![1,2].includes(m.p))throw Error("Invalid move sequence");
    b[m.i]=m.p;
    frames.push(b.slice());
  }
  return frames;
}
