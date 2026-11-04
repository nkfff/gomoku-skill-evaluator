// Shared settlement rules; a full-board draw keeps the existing 5x bonus.
export const WIN_REWARDS=Object.freeze({easy:10,normal:30,hard:80,gunuce:400});
export const isRewardLevel=level=>Object.hasOwn(WIN_REWARDS,level);
export function gameReward(level,result){
 if(!isRewardLevel(level)||![1,2,3].includes(result))throw new Error("未知难度或终局结果");
 return WIN_REWARDS[level]*(result===1?1:result===3?5:0);
}
