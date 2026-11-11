import {gameView,type Game,type Hit} from './scoring';
export type SoundEffect='triple-low'|'triple-mid'|'triple-high'|'bull'|'single-bull'|'double'|'leg-win'|'match-win';
export const victoryDuration={leg:10000,match:25000} as const;
export const victorySoundDuration={leg:3200,match:25000} as const;
export const effectFiles:Record<SoundEffect,string>={
 'triple-low':'triple-low.wav','triple-mid':'triple-mid.mp3','triple-high':'triple-high.wav',
 bull:'bull.mp3','single-bull':'single-bull.wav',double:'double.wav','leg-win':'leg-win.wav','match-win':'match-win.mp3',
};
export function hitEffect(hit:Hit):SoundEffect|null {
 if(hit.number===25)return hit.multiplier===2?'bull':'single-bull';
 if(hit.multiplier===3)return hit.number<10?'triple-low':hit.number<17?'triple-mid':'triple-high';
 return hit.multiplier===2?'double':null;
}
const same=(a:Hit|undefined,b:Hit)=>a?.number===b.number&&a.multiplier===b.multiplier;
/** Observe accepted shared state, including remote and automatic throws. Joining,
 * polling, undo and confirming an already heard visit never replay its sounds. */
export class SoundEffectTracker {
 private previous:Game|null=null;
 private wins=new Set<string>();
 update(game:Game):SoundEffect[]{
  const old=this.previous,view=gameView(game),effects:SoundEffect[]=[];
  const win=game.phase!=='bull'?(view.current.checkout?{player:view.active,leg:view.leg,turnCount:game.turns.length+1}:view.lastLegWin):null;
  const winKey=win?win.leg+':'+win.player+':'+win.turnCount:'';
  this.previous=structuredClone(game);
  if(!old){if(win)this.wins.add(winKey);return [];}
  if(game.turns.length<old.turns.length)return [];
  const hits=(next:Hit[],before:Hit[])=>next.forEach((hit,i)=>{if(!same(before[i],hit)){const effect=hitEffect(hit);if(effect)effects.push(effect);}});
  if(game.practice==='around-clock'||game.practice==='segments'){
   // Target practice has no score-based double/triple chimes.
  }else if(game.phase==='bull'){
   game.bull.forEach((hit,i)=>{if(hit&&!same(old.phase==='bull'&&old.bullRound===game.bullRound?old.bull[i]??undefined:undefined,hit)){const effect=hitEffect(hit);if(effect)effects.push(effect);}});
  }else{
   for(let index=old.turns.length;index<game.turns.length;index++)hits(game.turns[index].darts,index===old.turns.length?old.current:[]);
   hits(game.current,old.phase==='playing'&&old.turns.length===game.turns.length?old.current:[]);
  }
  if(win&&!this.wins.has(winKey)){
   this.wins.add(winKey);const legs=view.legs[win.player]+(view.current.checkout?1:0);
   effects.push(legs>=game.rules.legsToWin?'match-win':'leg-win');
  }
  return effects;
 }
}
