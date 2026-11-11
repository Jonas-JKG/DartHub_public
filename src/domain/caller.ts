import { checkout, gameView, practiceView, visit, type Game } from './scoring';
import { callerNumbers } from './audio-assets';
export type Call={key:string;type:'score'|'require'|'gameon';value?:number};
export type Clip={src:string;text:string};
export function callClips(call:Call,available=process.env.NEXT_PUBLIC_CALLER_PACK_ENABLED==='true'):Clip[]{
  if(!available)return [];
  if(call.type==='gameon')return [{src:'/audio/caller/gameon.wav',text:'Game on'}];
  const value=call.value??0,number={src:(callerNumbers as readonly number[]).includes(value)?'/audio/caller/'+value+'.wav':'',text:value===0?'No score':String(value)};
  return call.type==='require'?[{src:'/audio/caller/You_require.m4a',text:'You require'},number]:[number];
}
/** Derive calls from the shared game, so both local input and the opponent's
 * updates work. Polling, confirmation and unchanged corrections do not replay.
 */
export class CallerTracker{
  private previous:Game|null=null;
  private seen=new Set<string>();
  private scores=new Map<string,number>();
  update(g:Game):Call[]{
    const result:Call[]=[],view=gameView(g),old=this.previous;
    if(g.practice){
      const current=practiceView(g),before=old?.practice?practiceView(old):null;
      if(g.phase==='playing'&&!current.complete&&current.target!==null&&(!old||old.turns.length!==g.turns.length||before?.target!==current.target)){
        result.push({key:'target:'+g.turns.length+':'+g.current.length+':'+current.target,type:'require',value:current.target});
      }
      this.previous=structuredClone(g);return result;
    }
    const markScore=(call:Call)=>this.scores.set(call.key.split(':').slice(0,3).join(':'),call.value??0);
    const add=(call:Call)=>{if(call.type==='score'){const base=call.key.split(':').slice(0,3).join(':');if(this.scores.get(base)===call.value)return;markScore(call);result.push(call);}else if(!this.seen.has(call.key)){this.seen.add(call.key);result.push(call);}};
    const score=(index:number,darts:Game['current'])=>{
      const before=gameView({...g,turns:g.turns.slice(0,index),current:[]});
      const value=visit(before.startRemaining[before.active],darts,g.rules.out).credited;
      return {key:'score:'+index+':'+before.active+':'+value,type:'score' as const,value};
    };
    if(!old){
      for(const [index,turn] of g.turns.entries())markScore(score(index,turn.darts));
      if(g.phase==='playing'&&(g.current.length===3||view.current.bust||view.current.checkout))markScore(score(g.turns.length,g.current));
    }else{
      for(let index=old.turns.length;index<g.turns.length;index++)add(score(index,g.turns[index].darts));
      if(g.phase==='playing'&&(g.current.length===3||view.current.bust||view.current.checkout))add(score(g.turns.length,g.current));
    }
    if(g.phase==='playing'){
      if((old?.phase==='bull')||(!old&&g.turns.length===0&&g.current.length===0)||(old?.phase==='playing'&&gameView(old).leg<view.leg))add({key:'gameon:'+view.leg,type:'gameon'});
      if(!g.current.length&&checkout(view.remaining[view.active],g.rules.out,3).length)add({key:'require:'+g.turns.length+':'+view.active+':'+view.remaining[view.active],type:'require',value:view.remaining[view.active]});
    }
    this.previous=structuredClone(g);return result;
  }
}
