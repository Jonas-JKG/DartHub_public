import { DomainError } from './tournament';
export type Rules = { start: 301 | 501 | 701; out: 'single' | 'double'; legsToWin: number; groupLegsToWin?:number };
export const defaultRules: Rules = { start: 501, out: 'double', legsToWin: 2 };
export type Hit = { number: number; multiplier: 1 | 2 | 3; x: number; y: number; position?: {x:number;y:number} };
export type Turn = { player: number; darts: Hit[] };
export type TrainingMode='x01'|'around-clock'|'segments'|'checkout';
export type PracticeSettings={segments:number[]};
export type Game = { solo?:boolean; sharedDevice?:boolean; practice?:Exclude<TrainingMode,'x01'>; practiceSettings?:PracticeSettings; checkoutTargets?:number[]; players: string[]; rules: Rules; phase: 'bull' | 'playing' | 'finished'; bull: [Hit|null,Hit|null]; bullRound: number; bullConfirmed?: [boolean,boolean]; initialLegs?: [number,number]; starter: number | null; turns: Turn[]; current: Hit[]; version: number };
export type GameAction = { type:'bull'; hit:Hit } | {type:'dart';hit:Hit;index?:number} | {type:'undo'} | {type:'next'};
export const sectors = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];
export function boardHit(x:number,y:number): Hit {
  if (!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>2||Math.abs(y)>2) throw new DomainError('Ungültige Trefferposition.');
  const r=Math.hypot(x,y)*170;
  if(r>170)return {number:0,multiplier:1,x,y};
  if(r<=6.35)return {number:25,multiplier:2,x,y};
  if(r<=15.9)return {number:25,multiplier:1,x,y};
  const angle=(Math.atan2(x,-y)*180/Math.PI+360+9)%360;
  return {number:sectors[Math.floor(angle/18)],multiplier:r>=162?2:r>=99&&r<=107?3:1,x,y};
}
export function keypadHit(number:number,multiplier:1|2|3): Hit {
  if(!Number.isInteger(number)||number<0||number>25||(number>20&&number!==25)||(number===25&&multiplier===3)||(number===0&&multiplier!==1))throw new DomainError('Ungültiges Dartfeld.');
  if(number===0)return boardHit(1.12,0);
  if(number===25)return boardHit(multiplier===2?0:10/170,0);
  const angle=sectors.indexOf(number)*Math.PI/10, radius=(multiplier===2?166:multiplier===3?103:135)/170;
  return boardHit(Math.sin(angle)*radius,-Math.cos(angle)*radius);
}
export const points=(h:Hit)=>h.number*h.multiplier;
export const hitLabel=(h:Hit)=>h.number===0?'Fehlwurf':h.number===25?(h.multiplier===2?'Bull':'25'):`${h.multiplier===3?'T':h.multiplier===2?'D':'S'}${h.number}`;
export const hitPosition=(h:Hit)=>h.position??h;
export const hitDistanceMm=(h:Hit)=>Math.hypot(hitPosition(h).x,hitPosition(h).y)*170;
function validateHit(h:Hit) {if(h.position)boardHit(h.position.x,h.position.y);const actual=boardHit(h.x,h.y);if(actual.number!==h.number||actual.multiplier!==h.multiplier)throw new DomainError('Treffer und Position stimmen nicht überein.');}
export function createGame(players:[string,string],rules:Rules=defaultRules):Game {
  if(players[0]===players[1])throw new DomainError('Zwei unterschiedliche Spieler erforderlich.');
  if(![301,501,701].includes(rules.start)||!['single','double'].includes(rules.out)||!Number.isInteger(rules.legsToWin)||rules.legsToWin<1||rules.legsToWin>20||rules.groupLegsToWin!==undefined&&(!Number.isInteger(rules.groupLegsToWin)||rules.groupLegsToWin<1||rules.groupLegsToWin>20))throw new DomainError('Ungültige Spielregeln.');
  return {players,rules,phase:'bull',bull:[null,null],bullRound:1,bullConfirmed:[false,false],starter:null,turns:[],current:[],version:1};
}
export function createTrainingGame(players:string[],rules:Rules,solo:boolean,mode:TrainingMode='x01',soloPlayer=players[0],settings:PracticeSettings={segments:[20]},checkoutTargets?:number[]):Game {
 if(players.length<2||players.length>(mode==='around-clock'?6:2)||new Set(players).size!==players.length)throw new DomainError('Bitte höchstens sechs unterschiedliche Spieler auswählen.');
 if((mode==='segments'||mode==='checkout')&&!solo)throw new DomainError('Dieser Modus ist ein Solotraining.');
 const g=createGame([players[0],players[1]],mode==='around-clock'?{start:501,out:'single',legsToWin:1}:rules);
 const starter=solo?players.indexOf(soloPlayer):0;if(starter<0)throw new DomainError('Spieler nicht verfügbar.');
 if(mode==='around-clock')return {...g,players,solo,practice:'around-clock',phase:'playing',starter};
 if(mode==='segments'||mode==='checkout'){
  if(!settings.segments.length||settings.segments.length>20||new Set(settings.segments).size!==settings.segments.length||settings.segments.some(n=>!Number.isInteger(n)||n<1||n>20))throw new DomainError('Bitte Segmente von 1 bis 20 auswählen.');
  if(mode==='checkout'&&(!checkoutTargets||checkoutTargets.length!==10||checkoutTargets.some(n=>!Number.isInteger(n)||n<40||n>170||!checkout(n,rules.out).length)))throw new DomainError('Ungültige Checkout-Aufgaben.');
  return {...g,rules:{...rules,legsToWin:1},solo:true,practice:mode,practiceSettings:settings,...(mode==='checkout'?{checkoutTargets}:{}),phase:'playing',starter};
 }
 return solo?{...g,solo:true,phase:'playing',starter}:g;
}
export function aroundClockActive(g:Game){
 if(g.solo||!g.turns.length)return g.starter??0;
 const last=g.turns.at(-1)!;return g.phase==='finished'?last.player:(last.player+1)%g.players.length;
}
export function aroundClockView(g:Game,player=aroundClockActive(g)){
 const targets=[...Array.from({length:20},(_,i)=>i+1),25];let completed=0,darts=0;
 const hits=g.turns.filter(t=>t.player===player).flatMap(t=>t.darts);
 if(player===aroundClockActive(g))hits.push(...g.current);
 for(const h of hits){if(completed===21)break;darts++;if(h.number===targets[completed])completed++;}
 return {total:21,target:targets[completed]??null,completed,darts,complete:completed===21,accuracy:darts?100*completed/darts:0};
}
/** Replays accepted darts so corrections, takeout and reload share one result. */
export function practiceView(g:Game){
 if(g.practice==='around-clock')return {...aroundClockView(g),bust:false,turnComplete:aroundClockView(g).complete};
 const turns=g.turns,all=[...turns.map(t=>t.darts),...(g.current.length?[g.current]:[])];
 const darts=all.reduce((n,h)=>n+h.length,0);
 if(g.practice==='segments'){
  const segments=g.practiceSettings?.segments??[20];let hits=0;
  all.forEach((visit,i)=>visit.forEach(h=>{if(h.number===segments[i%segments.length])hits++;}));
  return {target:segments[turns.length%segments.length],completed:hits,total:30,darts,complete:darts>=30,accuracy:darts?100*hits/darts:0,bust:false,turnComplete:darts>=30};
 }
 const targets=g.checkoutTargets??[],start=targets[turns.length]??0,v=visit(start,g.current,g.rules.out);
 const completed=turns.filter((t,i)=>visit(targets[i],t.darts,g.rules.out).checkout).length+(v.checkout?1:0);
 return {target:g.phase==='finished'?null:v.remaining,completed,total:10,darts,complete:turns.length>=10||turns.length===9&&(g.current.length===3||v.checkout||v.bust),accuracy:100*completed/Math.max(1,turns.length+(g.current.length?1:0)),bust:v.bust,turnComplete:v.checkout||v.bust||g.current.length===3};
}
export function bullWinner(a:Hit,b:Hit):0|1|null {
  const rank=(h:Hit)=>h.number===25?h.multiplier:0,ra=rank(a),rb=rank(b);
  if(ra!==rb)return ra>rb?0:1;
  if(ra>0)return null;
  const da=hitDistanceMm(a),db=hitDistanceMm(b);
  return Math.abs(da-db)<0.0017?null:da<db?0:1;
}
export function visit(start:number,darts:Hit[],out:Rules['out']) {
  let remaining=start,credited=0,used=0,bust=false,checkout=false;
  for(const h of darts) {
    used++;remaining-=points(h);credited+=points(h);
    if(remaining<0||(out==='double'&&(remaining===1||(remaining===0&&h.multiplier!==2)))){bust=true;remaining=start;credited=0;break;}
    if(remaining===0){checkout=true;break;}
  }
  return {remaining,credited,used,bust,checkout};
}
export function gameView(g:Game) {
  if(g.practice==='around-clock'){
    const active=aroundClockActive(g),v=aroundClockView(g),all=g.players.map((_,i)=>aroundClockView(g,i));
    const remaining=all.map(p=>p.target??0),legs=all.map((_,i)=>g.phase==='finished'&&i===active?1:0),darts=all.map(p=>p.darts);
    return {legDarts:darts,legAverage:all.map(()=>0),legTurns:g.turns,lastLegWin:g.phase==='finished'?{player:active,leg:1,turnCount:g.turns.length}:null,active,remaining,startRemaining:remaining,legs,darts,average:all.map(()=>0),current:{remaining:v.target??0,credited:0,used:g.current.length,bust:false,checkout:g.phase!=='finished'&&v.complete},leg:1};
  }
  if(g.practice){
    const active=g.starter??0,v=practiceView(g),remaining=g.players.map((_,i)=>i===active?v.target??0:0),darts=g.players.map((_,i)=>i===active?v.darts:0),legs=g.players.map((_,i)=>i===active&&g.phase==='finished'?1:0);
    return {legDarts:darts,legAverage:g.players.map(()=>0),legTurns:g.turns,lastLegWin:g.phase==='finished'?{player:active,leg:1,turnCount:g.turns.length}:null,active,remaining,startRemaining:remaining,legs,darts,average:g.players.map(()=>0),current:{remaining:v.target??0,credited:0,used:g.current.length,bust:v.bust,checkout:g.phase!=='finished'&&v.complete},leg:1};
  }
  let active=g.starter??0,legStarter=active;
  const remaining:[number,number]=[g.rules.start,g.rules.start],legs:[number,number]=[...(g.initialLegs??[0,0])],darts:[number,number]=[0,0],credited:[number,number]=[0,0];
  const legDarts:[number,number]=[0,0],legCredited:[number,number]=[0,0];
  let legTurns:Turn[]=[],lastLegWin:{player:number;leg:number;turnCount:number}|null=null;
  for(const [turnIndex,turn] of g.turns.entries()) {
    const v=visit(remaining[turn.player],turn.darts,g.rules.out);darts[turn.player]+=v.used;credited[turn.player]+=v.credited;remaining[turn.player]=v.remaining;
    legDarts[turn.player]+=v.used;legCredited[turn.player]+=v.credited;legTurns.push(turn);
    if(v.checkout){lastLegWin={player:turn.player,leg:legs[0]+legs[1]+1,turnCount:turnIndex+1};legDarts[0]=legDarts[1]=legCredited[0]=legCredited[1]=0;legTurns=[];legs[turn.player]++;remaining[0]=remaining[1]=g.rules.start;legStarter=g.solo?(g.starter??0):legStarter===0?1:0;active=legStarter;}
    else active=g.solo?(g.starter??0):turn.player===0?1:0;
  }
  const current=visit(remaining[active],g.current,g.rules.out);
  const displayRemaining:[number,number]=[...remaining];displayRemaining[active]=current.remaining;
  const displayDarts:[number,number]=[...darts];displayDarts[active]+=current.used;
  const displayCredited:[number,number]=[...credited];displayCredited[active]+=current.credited;
  legDarts[active]+=current.used;legCredited[active]+=current.credited;
  return {legDarts,legAverage:legDarts.map((n,i)=>n?3*legCredited[i]/n:0),legTurns,lastLegWin,active,remaining:displayRemaining,startRemaining:remaining,legs,darts:displayDarts,average:displayDarts.map((n,i)=>n?3*displayCredited[i]/n:0),current,leg:legs[0]+legs[1]+1};
}
export function gameAction(previous:Game,playerId:string,action:GameAction):Game {
  const g=structuredClone(previous),index=g.players.indexOf(playerId);
  if(index<0||g.solo&&index!==(g.starter??0))throw new DomainError('Zuschauer können keine Würfe eintragen.');
  if(g.phase==='finished')throw new DomainError('Das Match ist beendet.');
  if(g.practice==='around-clock'){
    if(g.phase!=='playing'||g.players.length>6)throw new DomainError('Ungültiges Solotraining.');
    const active=aroundClockActive(g);if(index!==active)throw new DomainError('Du bist gerade nicht an der Reihe.');
    if(action.type==='dart'){
      validateHit(action.hit);const slot=action.index??g.current.length;
      if(!Number.isInteger(slot)||slot<0||slot>g.current.length||slot>2||slot===g.current.length&&aroundClockView(g).complete)throw new DomainError('Die Aufnahme ist beendet. Bitte Weiter drücken oder korrigieren.');
      g.current[slot]=action.hit;
      const used=aroundClockView(g).darts-g.turns.filter(t=>t.player===active).reduce((n,t)=>n+t.darts.length,0);g.current=g.current.slice(0,used);
    }else if(action.type==='undo'){
      if(g.current.length)g.current.pop();else if(g.turns.at(-1)?.player===active)g.current=g.turns.pop()!.darts;else throw new DomainError('Für diesen Spieler gibt es keinen Dart zum Zurücknehmen.');
    }else if(action.type==='next'){
      if(!g.current.length)throw new DomainError('Bitte mindestens einen Dart eintragen.');
      const complete=aroundClockView(g).complete;g.turns.push({player:active,darts:g.current});g.current=[];if(complete)g.phase='finished';
    }else throw new DomainError('Bei Around the Clock wird nicht ausgebullt.');
    g.version++;return g;
  }
  if(g.practice){
    if(index!==(g.starter??0))throw new DomainError('Du bist gerade nicht an der Reihe.');
    if(action.type==='dart'){
      validateHit(action.hit);const slot=action.index??g.current.length,v=practiceView(g);
      if(!Number.isInteger(slot)||slot<0||slot>g.current.length||slot>2||slot===g.current.length&&(v.turnComplete||v.complete))throw new DomainError('Die Aufnahme ist beendet. Bitte Weiter drücken oder korrigieren.');
      g.current[slot]=action.hit;
      const used=g.practice==='checkout'?visit(g.checkoutTargets![g.turns.length],g.current,g.rules.out).used:Math.min(g.current.length,30-g.turns.reduce((n,t)=>n+t.darts.length,0));g.current=g.current.slice(0,used);
    }else if(action.type==='undo'){
      if(g.current.length)g.current.pop();else if(g.turns.length)g.current=g.turns.pop()!.darts;
    }else if(action.type==='next'){
      if(!g.current.length)throw new DomainError('Bitte mindestens einen Dart eintragen.');
      const complete=practiceView(g).complete||g.practice==='checkout'&&g.turns.length===9;g.turns.push({player:index,darts:g.current});g.current=[];if(complete)g.phase='finished';
    }else throw new DomainError('Bei diesem Training wird nicht ausgebullt.');
    g.version++;return g;
  }
  if(g.phase==='bull') {
    g.bullConfirmed??=[false,false];
    if(action.type==='bull') {
      validateHit(action.hit);g.bull[index]=action.hit;g.bullConfirmed[index]=false;
    }else if(action.type==='next') {
      if(!g.bull[index])throw new DomainError('Bitte zuerst deinen Bull-Treffer markieren.');
      g.bullConfirmed[index]=true;
      if(g.bullConfirmed.every(Boolean)&&g.bull.every(Boolean)) {
        const winner=bullWinner(g.bull[0]!,g.bull[1]!);
        if(winner===null){g.bull=[null,null];g.bullConfirmed=[false,false];g.bullRound++;}else{g.starter=winner;g.phase='playing';}
      }
    }else if(action.type==='undo'){g.bull[index]=null;g.bullConfirmed[index]=false;}
    else throw new DomainError('Bitte zuerst ausbullen.');
  } else {
    const view=gameView(g);
    if(view.active!==index)throw new DomainError('Du bist gerade nicht an der Reihe.');
    if(action.type==='bull')throw new DomainError('Das Ausbullen ist abgeschlossen.');
    if(action.type==='dart') {
      validateHit(action.hit);
      const slot=action.index??g.current.length;
      if(!Number.isInteger(slot)||slot<0||slot>g.current.length||slot>2)throw new DomainError('Ungültiger Dart.');
      if(slot===g.current.length&&(view.current.bust||view.current.checkout))throw new DomainError('Die Aufnahme ist beendet. Bitte Weiter drücken oder korrigieren.');
      g.current[slot]=action.hit;
      // Corrections that end a visit discard later darts, which could not have been thrown.
      const v=visit(view.startRemaining[view.active],g.current,g.rules.out);g.current=g.current.slice(0,v.used);
    }else if(action.type==='undo') {
      if(g.current.length)g.current.pop();
      else if(g.turns.length){const last=g.turns.pop()!;g.current=last.darts;}
    }else if(action.type==='next') {
      if(!g.current.length)throw new DomainError('Bitte mindestens einen Dart eintragen.');
      g.turns.push({player:view.active,darts:g.current});g.current=[];
      const next=gameView(g);if(next.legs.some(n=>n>=g.rules.legsToWin))g.phase='finished';
    }
  }
  g.version++;return g;
}
const candidates:Hit[]=[...Array.from({length:20},(_,i)=>keypadHit(20-i,3)),...Array.from({length:20},(_,i)=>keypadHit(20-i,1)),keypadHit(25,1),...Array.from({length:20},(_,i)=>keypadHit(20-i,2)),keypadHit(25,2)];
export function checkout(remaining:number,out:Rules['out'],dartsLeft=3):string[] {
  if(remaining<1||remaining>(out==='double'?170:180)||dartsLeft<1)return [];
  const memo=new Set<string>();
  function find(rest:number,left:number):Hit[]|null {
    const final=out==='double'?candidates.filter(h=>h.multiplier===2):candidates;
    const one=final.find(h=>points(h)===rest);if(one)return [one];
    if(left<2)return null;
    const key=`${rest}:${left}`;if(memo.has(key))return null;
    for(const h of candidates){const n=rest-points(h);if(n<1||(out==='double'&&n===1))continue;const tail=find(n,left-1);if(tail)return [h,...tail];}
    memo.add(key);return null;
  }
  for(let n=1;n<=dartsLeft;n++){const result=find(remaining,n);if(result)return result.map(hitLabel);}
  return [];
}

export function recommendation(remaining:number,out:Rules['out'],dartsLeft=3):{kind:'checkout'|'setup';route:string[];leave:number}|null {
  if(remaining<1||remaining>=180||dartsLeft<1)return null;
  const finish=checkout(remaining,out,dartsLeft);if(finish.length)return {kind:'checkout',route:finish,leave:0};
  const setupHits=candidates.filter(h=>h.multiplier!==2);
  const targets=out==='double'?[32,40,16,24,20,8,12,4,36,28,48,44,52,56,60,50,64,80,72,100,120,110,90]:[20,40,60,50,30,10];
  const fallback=Array.from({length:Math.min(remaining-1,170)},(_,i)=>i+1).filter(n=>out==='single'||n>=2&&checkout(n,'double').length>0);
  for(const target of [...new Set([...targets,...fallback])]) {
    const wanted=remaining-target;if(wanted<=0||wanted>60*dartsLeft)continue;
    const memo=new Set<string>();
    function find(score:number,left:number):Hit[]|null {
      const one=setupHits.find(h=>points(h)===score);if(one)return [one];
      if(left<2||score>60*left)return null;
      const key=score+':'+left;if(memo.has(key))return null;
      for(const hit of setupHits){const next=score-points(hit);if(next<=0)continue;const tail=find(next,left-1);if(tail)return [hit,...tail];}
      memo.add(key);return null;
    }
    for(let count=1;count<=dartsLeft;count++){const route=find(wanted,count);if(route)return {kind:'setup',route:route.map(hitLabel),leave:target};}
  }
  return null;
}
