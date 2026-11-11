import {isConnectFour,connectFourView} from '../domain/connect-four';
import {isTicTacToe,ticTacToeView} from '../domain/tic-tac-toe';
import {isBingo,bingoProgress} from '../domain/bingo';
import {cardAchieved,deckCard,deckVisitKey,type PublicDeckGame} from '../domain/dartdeck';
export type DeckEffect='target'|'hit'|'miss'|'success'|'skip'|'turn'|'finish';
/** Shared-state transitions only: polling, joining and corrections stay quiet. */
export class DeckEffectTracker {
 private previous:PublicDeckGame|null=null;
 private successes=new Set<string>();
 update(game:PublicDeckGame):DeckEffect[]{
  const old=this.previous;this.previous=structuredClone(game);
  if(isConnectFour(game)){if(!old||old.id!==game.id)return [];if(game.phase==='finished'&&old.phase!=='finished')return ['finish'];if(game.visits.length>old.visits.length)return ['turn'];if(game.current.length>old.current.length)return [connectFourView(game).index>=0?'target':'miss'];return [];}
  if(isTicTacToe(game)){if(!old||old.id!==game.id)return [];if(game.phase==='finished'&&old.phase!=='finished')return ['finish'];if(game.visits.length>old.visits.length)return ['turn'];if(ticTacToeView(game).claim>=0&&ticTacToeView(old).claim<0)return ['success'];if(game.current.length>old.current.length)return [game.current.at(-1)?.number===0?'miss':'hit'];return [];}
  if(isBingo(game)){
   if(!old||old.id!==game.id)return [];
   if(game.phase==='finished'&&old.phase!=='finished')return ['finish'];
   if(game.visits.length>old.visits.length)return ['turn'];
   if(deckVisitKey(game)===deckVisitKey(old)&&game.current.length>old.current.length){
    const player=game.players[game.active].id,before=bingoProgress(old,player),after=bingoProgress(game,player);
    if(after.lines.length>before.lines.length)return ['success'];
    if(after.marked.length>before.marked.length)return ['target'];
    return [game.current.at(-1)?.number===0?'miss':'hit'];
   }
   return [];
  }
  const key=deckVisitKey(game),achieved=cardAchieved(deckCard(game.cardId),game.current);
  if(!old||old.id!==game.id){this.successes.clear();if(achieved)this.successes.add(key);return [];}
  if(game.phase==='finished'&&old.phase!=='finished')return ['finish'];
  if(game.draw!==old.draw&&game.visits.length===old.visits.length)return ['skip'];
  if(achieved&&!this.successes.has(key)){this.successes.add(key);return ['success'];}
  if(game.visits.length>old.visits.length)return [game.visits.slice(old.visits.length).some(v=>v.won)&&!this.successes.has(deckVisitKey(old))?'success':'turn'];
  if(key===deckVisitKey(old)&&game.current.length>old.current.length){const hit=game.current.at(-1)!,card=deckCard(game.cardId);const useful=card.kind==='hits'?card.targets.includes(hit.number)&&(!card.multiplier||card.multiplier===hit.multiplier):card.kind==='set'?card.targets.includes(hit.number)&&!old.current.some(h=>h.number===hit.number):card.kind==='parity'?hit.number>=1&&hit.number<=20&&hit.number%2===card.value:hit.number>0&&(card.kind!=='exact'||game.current.reduce((s,h)=>s+h.number*h.multiplier,0)<=card.value!);return [useful?'target':hit.number===0?'miss':'hit'];}
  return [];
 }
}
/** Original short tones, no caller, music, third-party recordings or network requests. */
export class DeckEffectsAudio {
 private context:AudioContext|null=null;
 private pending:DeckEffect|null=null;
 private gain=.25;
 private nodes=new Map<OscillatorNode,()=>void>();
 unlock(){
  const Context=window.AudioContext??(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  if(!Context)return;
  this.context??=new Context();
  void this.context.resume().then(()=>{if(this.pending){const effect=this.pending;this.pending=null;this.play(effect);}}).catch(()=>{});
 }
 volume(value:number){this.gain=Math.max(0,Math.min(1,value));if(!this.gain)this.stop();}
 play(effect:DeckEffect){
  if(!this.gain)return;
  if(!this.context||this.context.state!=='running'){this.pending=effect;return;}
  const ctx=this.context;
  const tone=(frequency:number,time:number,duration:number,level=1,end=frequency)=>{
   const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.setValueAtTime(frequency,ctx.currentTime+time);osc.frequency.exponentialRampToValueAtTime(end,ctx.currentTime+time+duration);
   gain.gain.setValueAtTime(0,ctx.currentTime+time);gain.gain.linearRampToValueAtTime(this.gain*level,ctx.currentTime+time+.006);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+time+duration);
   osc.connect(gain);gain.connect(ctx.destination);const cleanup=()=>{this.nodes.delete(osc);osc.disconnect();gain.disconnect();};this.nodes.set(osc,cleanup);osc.onended=cleanup;osc.start(ctx.currentTime+time);osc.stop(ctx.currentTime+time+duration+.01);
  };
  if(effect==='target'){tone(520,0,.12,.55);tone(780,.04,.12,.3);}
  if(effect==='hit')tone(210,0,.08,.6,85);
  if(effect==='miss')tone(105,0,.06,.35,55);
  if(effect==='turn')tone(440,0,.10,.4,320);
  if(effect==='skip'){tone(540,0,.12,.5,210);tone(740,.10,.12,.4,400);}
  if(effect==='success'){tone(660,0,.18,.65);tone(880,.10,.25,.55);}
  if(effect==='finish')for(const [i,note] of [523,659,784,1047].entries())tone(note,i*.12,.35,.6);
 }
 stop(){this.pending=null;for(const [node,cleanup] of this.nodes){node.onended=null;node.stop();cleanup();}this.nodes.clear();}
 dispose(){this.stop();void this.context?.close().catch(()=>{});this.context=null;}
}
