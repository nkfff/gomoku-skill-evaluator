// 15x15 freestyle rules and batch-one PUCT. Value is always side to move.
const SIZE=15,CELLS=225;
const WINDOWS=[];
for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]])for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++)if(r+4*dr>=0&&r+4*dr<SIZE&&c+4*dc>=0&&c+4*dc<SIZE)WINDOWS.push(Array.from({length:5},(_,k)=>(r+k*dr)*SIZE+c+k*dc));
export function won(board,action,player){
 const r=Math.floor(action/SIZE),c=action%SIZE;
 for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]){let count=1;for(const sign of [-1,1]){let y=r+sign*dr,x=c+sign*dc;while(y>=0&&y<SIZE&&x>=0&&x<SIZE&&board[y*SIZE+x]===player){count++;y+=sign*dr;x+=sign*dc}}if(count>=5)return true}return false;
}
export function fastWins(board,player){
 let stones=0;for(const p of board)if(p===player)stones++;if(stones<4)return [];
 const result=new Set();for(const line of WINDOWS){let own=0,empty=0,action=-1;for(const a of line){if(board[a]===player)own++;else if(board[a]===0){empty++;action=a}}if(own===4&&empty===1)result.add(action)}return [...result].sort((a,b)=>a-b);
}
export function validatePosition(board,player,last){
 if(!board||board.length!==CELLS||![1,2].includes(player))throw Error('棋盘格式无效');let black=0,white=0;
 for(const stone of board){if(!Number.isInteger(stone)||stone<0||stone>2)throw Error('棋子编码无效');if(stone===1)black++;if(stone===2)white++}
 if(!(black===white||black===white+1)||player!==(black===white?1:2))throw Error('棋子数量与行动方不符');
 if(!Number.isInteger(last)||last< -1||last>=CELLS||(black+white?last<0||board[last]!==3-player:last!==-1))throw Error('上一手无效');
 if(black+white===CELLS)throw Error('棋盘已满');
 for(let a=0;a<CELLS;a++)if(board[a]&&won(board,a,board[a]))throw Error('棋局已结束');
}
export function encode(board,player,last){const state=new Float32Array(4*CELLS);for(let i=0;i<CELLS;i++){if(board[i]===player)state[i]=1;if(board[i]===3-player)state[CELLS+i]=1;if(player===1)state[3*CELLS+i]=1}if(last>=0)state[2*CELLS+last]=1;return state}
export class Node{
 constructor(board,player,last=-1,winner=0){this.board=Int8Array.from(board);this.player=player;this.last=last;this.winner=winner;this.actions=null;this.children=new Map()}
 expand(logits,tactical=true){
  let actions=[];for(let i=0;i<CELLS;i++)if(!this.board[i])actions.push(i);
  const own=tactical?fastWins(this.board,this.player):[],threat=tactical&&!own.length?fastWins(this.board,3-this.player):[];
  if(own.length)actions=own;else if(threat.length===1)actions=threat;
  this.actions=actions;const maximum=Math.max(...actions.map(a=>logits[a]));let sum=0;this.prior=Float64Array.from(actions,a=>{const p=Math.exp(logits[a]-maximum);sum+=p;return p});for(let i=0;i<actions.length;i++)this.prior[i]/=sum;
  this.n=new Int32Array(actions.length);this.w=new Float64Array(actions.length);return own.length?1:threat.length>1?-1:null;
 }
 child(index){if(!this.children.has(index)){const a=this.actions[index],board=this.board.slice();board[a]=this.player;this.children.set(index,new Node(board,3-this.player,a,won(board,a,this.player)?this.player:0))}return this.children.get(index)}
}
export function backup(path,value){for(let i=path.length-1;i>=0;i--){value=-value;const [node,index]=path[i];node.n[index]++;node.w[index]+=value}}
export function select(root,cPuct=1.5){let node=root;const path=[];while(node.actions!==null&&!node.winner&&node.board.includes(0)){let total=1;for(const n of node.n)total+=n;const scale=Math.sqrt(total);let best=-Infinity,index=0;for(let i=0;i<node.actions.length;i++){const q=node.n[i]?node.w[i]/node.n[i]:0,score=q+cPuct*node.prior[i]*scale/(1+node.n[i]);if(score>best){best=score;index=i}}path.push([node,index]);node=node.child(index)}return [node,path]}
export async function search(root,infer,{simulations=128,tactical=true,cPuct=1.5,onProgress=()=>{},isCancelled=()=>false,yieldEvery=8}={}){
 if(!Number.isInteger(simulations)||simulations<1)throw Error('搜索次数无效');if(root.winner||!root.board.includes(0))throw Error('不能搜索终局');
 async function evaluate(node){const output=await infer(encode(node.board,node.player,node.last));const proof=node.expand(output.policy,tactical);return proof===null?Number(output.value):proof}
 if(root.actions===null)await evaluate(root);
 for(let i=0;i<simulations;i++){
  if(isCancelled())throw Error('Gunuce任务已取消');const [node,path]=select(root,cPuct);
  const value=node.winner?(node.winner===node.player?1:-1):!node.board.includes(0)?0:await evaluate(node);backup(path,value);
  if((i+1)%yieldEvery===0||i+1===simulations){onProgress(i+1,simulations);await new Promise(resolve=>setTimeout(resolve,0))}
 }
 const policy=new Float32Array(CELLS);let total=0,index=0;for(let i=0;i<root.n.length;i++){total+=root.n[i];if(root.n[i]>root.n[index])index=i}for(let i=0;i<root.n.length;i++)policy[root.actions[i]]=root.n[i]/total;
 return {index:root.actions[index],policy,visits:root.n,simulations};
}
