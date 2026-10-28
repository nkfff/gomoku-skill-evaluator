import {analyzeMove} from "./assessment.js";
self.onmessage=e=>{
  const {gameId,moveId,board,player,played}=e.data;
  try {
    const quality=analyzeMove(board,player,played);
    self.postMessage({gameId,moveId,quality});
  }catch(error){self.postMessage({gameId,moveId,error:String(error)});}
};
