import {CELLS,coord,immediateWins,pointShape,rankedMoves} from "./engine.js";
function boardBefore(moves,index){const board=Array(CELLS).fill(0);for(let i=0;i<index;i++){const m=moves[i];if(m&&Number.isInteger(m.i)&&m.i>=0&&m.i<CELLS)board[m.i]=m.p;}return board;}
function moveTopic(category,shape){if(category.includes("漏防")||category.includes("化解"))return "防守优先级与强制应手";if(category.includes("漏杀")||category.includes("胜点"))return "直接成五与必胜点识别";if(shape&&shape!=="普通")return shape;if(category.includes("失误")||category.includes("偏差"))return "候选点比较与两步计算";return "攻防节奏与棋形判断";}
export function buildMoveInsight(moves,index,playerColor){
 if(!Array.isArray(moves)||!Number.isInteger(index)||index<0||index>=moves.length||![1,2].includes(playerColor))throw Error("Invalid review move");
 const move=moves[index],before=boardBefore(moves,index),shape=pointShape(before,move.i,move.p).kind,q=move.quality||null,legacy=move.analysis||{},category=String(q?.category||legacy.category||"尚未完成分析");
 const alternatives=[...new Set((q?.alternatives||legacy.alternatives||[]).filter(i=>Number.isInteger(i)&&i>=0&&i<CELLS))],alt=alternatives.length?alternatives.map(coord).join("、"):"暂无可靠候选点";
 let verdict="待分析",explanation="",recommendation="",kind="neutral";
 if(category.includes("不可避免")){verdict="局面已难以挽回";explanation="在这一步之前，对手已经形成无法通过单手全部化解的直接成五威胁。本手不应被简单归类为主要失误，真正需要回看的是更早出现的防守窗口。";recommendation="向前回看 1–3 手，寻找对手形成连续威胁之前的封堵点；遇到双重威胁时，优先阻止威胁形成。";}
 else if(category.includes("漏杀")){verdict="错过直接胜点";kind="error";explanation="落子前己方已经存在直接成五的机会，但本手没有完成终结。能够立即获胜的着法优先级高于继续扩张棋形。";recommendation="候选落点："+alt+"。复盘时先枚举自己下一手能否成五，再考虑制造活三、冲四或扩大势力。";}
 else if(category.includes("漏防")){verdict="漏掉强制防守";kind="error";explanation="落子前对手已经拥有直接成五点，本手没有有效封堵。此时继续进攻通常没有意义，因为对手下一手即可结束对局。";recommendation="优先检查："+alt+"。每次对手落子后，先扫描其是否出现一步成五点，再决定自己的进攻计划。";}
 else if(category.includes("抓住直接胜点")){verdict="抓住必胜机会";kind="good";explanation="这一步识别并兑现了直接成五机会，是明确的强制着法。关键是及时发现可以结束对局的落点。";recommendation="保持这个检查顺序：先看自己能否直接获胜，再看对手是否有直接胜点，最后才比较普通攻防候选。";}
 else if(category.includes("成功化解")){verdict="完成关键防守";kind="good";explanation="这一步优先处理了对手的直接成五威胁，避免了立即失利。面对强制威胁时，先保住局面再寻找反击，是正确的决策顺序。";recommendation="防守后继续检查是否留下反击点，以及对手是否仍有连续冲四或双重威胁。";}
 else if(category.includes("严重失误")){verdict="严重偏离搜索首选";kind="error";explanation="有限深度的本地搜索认为，本手与当前候选中的较优着法存在明显差距。它不等于职业引擎的绝对判决，但值得重点复盘。";recommendation="搜索给出的优先候选为："+alt+"。比较这些点分别回应了什么威胁、能否形成连续攻势，以及对手最强应手是什么。";}
 else if(category.includes("明显偏差")){verdict="存在更好的选择";kind="warn";explanation="本手并非必然导致失利，但局面评估认为另有更有价值的候选。需要比较进攻效率、防守覆盖和下一手的延续性。";recommendation="建议重点比较："+alt+"。分别想象对手最强回应，不要只看己方落子后形成的局部棋形。";}
 else if(category.includes("小幅偏差")){verdict="有优化空间";kind="warn";explanation="本手总体仍可接受，但搜索评估发现了小幅优势差。它更适合作为棋形选择和节奏优化的训练材料，而不是严重失误。";recommendation="候选参考："+alt+"。练习比较落点是否同时兼顾自己的成形速度与对手的潜在威胁。";}
 else if(category.includes("搜索首选")||q?.top1){verdict="命中搜索首选";kind="good";explanation="本地有限搜索将本手列为当前候选中的首选。若该位置没有遗漏强制攻防，这是一手质量较高的着法。";recommendation="记住这一步背后的判断依据：它如何改善己方棋形、限制对手空间，并为下一手保留选择。";}
 else if(shape!=="普通"){verdict="形成关键棋形："+shape;kind="good";explanation="本手在局部形成了"+shape+"结构。棋形提供了进攻潜力，但仍需结合对手的直接威胁和后续强制应手判断价值。";recommendation="继续检查该棋形能否转化为冲四、活四或双重威胁，不要只因形成漂亮棋形就忽略对方反击。";}
 else{verdict="普通候选着法";explanation="当前分析没有识别出直接胜负机会或特别突出的棋形。本手需要结合全盘威胁、连接效率和对手的最佳回应来判断。";recommendation="先检查双方所有一步成五点，再比较能制造连续威胁、同时限制对手的落点。";}
 const loss=Number.isFinite(q?.loss)?q.loss:null,rank=Number.isFinite(q?.rank)?q.rank:(Number.isFinite(legacy.rank)?legacy.rank:null),count=Number.isFinite(q?.candidateCount)?q.candidateCount:null;
 const metrics=["思考 "+(Number.isFinite(move.seconds)?move.seconds.toFixed(1)+" 秒":"时间未知"),rank!==null?"搜索候选排名 "+rank+(count!==null?"/"+count:""):"",loss!==null?"估计落子损失 "+loss.toFixed(1)+"/200":""].filter(Boolean).join(" · ");
 return {index,coord:coord(move.i),role:move.p===playerColor?"你的着法":"AI 的着法",verdict,explanation,recommendation,metrics,kind,topic:moveTopic(category,shape),category,alternatives};
}
export function analyzeCurrentPosition(board,player){
 if(!Array.isArray(board)||board.length!==CELLS||![1,2].includes(player))throw Error("Invalid review position");
 const ownWins=immediateWins(board,player),enemyWins=immediateWins(board,3-player),candidates=rankedMoves(board,player,3);let type="normal",reason="没有发现一步成五的强制手。下面列出本地启发式引擎优先考虑的三个空点，供你比较攻防延续。";
 if(ownWins.length){type="win";reason="当前一方存在直接成五点，应优先结束对局。";}else if(enemyWins.length>1){type="double-threat";reason="对手同时存在多个直接成五点，单步可能无法全部封堵。应回看更早的防守窗口，避免威胁同时形成。";}else if(enemyWins.length===1){type="defense";reason="对手存在直接成五威胁，下一手应优先封堵对应落点，不宜先做普通进攻。";}
 return {type,reason,moves:candidates.map(index=>({index,coord:coord(index),shape:pointShape(board,index,player).kind}))};
}
export function collectReviewHighlights(moves,playerColor){
 const ranked=[];moves.forEach((move,index)=>{if(move.p!==playerColor||!move.quality)return;const q=move.quality,category=String(q.category||"");let priority=0,kind="neutral",label="",reason="";
 if(q.severe||category.includes("漏杀")||category.includes("漏防")){priority=4;kind="error";label=category.includes("漏杀")?"错过直接胜点":category.includes("漏防")?"漏掉关键防守":"严重失误";reason="搜索损失 "+(Number.isFinite(q.loss)?q.loss.toFixed(1):"未知")+"；建议回看此手及之前的威胁形成过程。";}
 else if(Number.isFinite(q.loss)&&q.loss>=25&&!q.top3){priority=3;kind="error";label="明显偏离候选";reason="本手与前三候选差距较大，适合比较不同落点的后续变化。";}
 else if(q.opportunityCorrect||q.top1&&q.opportunity){priority=2;kind="good";label=q.opportunity==="attack"?"抓住进攻机会":"处理关键攻防";reason="在关键战术位置作出了正确选择，值得总结判断顺序。";}
 if(priority)ranked.push({index,coord:coord(move.i),kind,label,reason,priority});});
 ranked.sort((a,b)=>b.priority-a.priority||a.index-b.index);return ranked.slice(0,6).sort((a,b)=>a.index-b.index);
}
export function buildTrainingAdvice(moves,playerColor){
 const own=moves.filter(move=>move.p===playerColor),analyzed=own.filter(move=>move.quality),missedAttack=analyzed.filter(move=>String(move.quality.category||"").includes("漏杀")).length,missedDefense=analyzed.filter(move=>String(move.quality.category||"").includes("漏防")).length,severe=analyzed.filter(move=>move.quality.severe).length,avgTime=own.length?own.reduce((sum,move)=>sum+(Number(move.seconds)||0),0)/own.length:0,items=[];
 if(missedDefense)items.push({title:"防守优先级",body:"对手每次落子后，先枚举对方下一手能否直接成五；若存在，优先封堵，再考虑自己的进攻。"});
 if(missedAttack)items.push({title:"必胜点识别",body:"自己落子前先检查是否已有直接成五点。不要为了制造更复杂的棋形，放弃已经存在的强制胜着。"});
 if(severe>=2)items.push({title:"两步候选计算",body:"每手至少比较两个候选点，并分别推演对手最强回应；重点检查连续冲四、双重威胁和反击窗口。"});
 if(severe>0&&avgTime<3)items.push({title:"关键手放慢节奏",body:"本局出现明显偏差且平均思考时间较短。遇到冲四、活三或对手形成威胁时，刻意多花几秒完成强制手检查。"});
 if(!items.length&&analyzed.length)items.push({title:"保持优势判断",body:"本局没有明显的强制攻防遗漏。继续练习在进攻时同步检查对手反击，并总结命中搜索首选的棋形条件。"});
 if(!items.length)items.push({title:"先积累有效样本",body:"当前可用分析较少。完成更多对局后，系统才能更可靠地识别你经常出现的攻防问题。"});
 return {headline:"基于 "+analyzed.length+" 手已完成分析的玩家着法，生成以下训练方向。",items};
}
