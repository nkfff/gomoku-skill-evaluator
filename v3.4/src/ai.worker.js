import {chooseAI} from "./engine.js";
import {chooseRandomMove} from "./special-modes.js";

self.onmessage=({data})=>{
  const {requestId,mode,board,level,size,connect,player=2}=data||{};
  try{
    const result=mode==="random"
      ?{index:chooseRandomMove(board,size,connect,player)}
      :chooseAI(board,level);
    self.postMessage({requestId,result});
  }catch(error){
    self.postMessage({requestId,error:error&&error.message?error.message:"AI 搜索失败"});
  }
};
