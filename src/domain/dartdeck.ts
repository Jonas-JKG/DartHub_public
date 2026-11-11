import type {ConnectFourState} from './connect-four';
import type {TicTacToeState} from './tic-tac-toe';
import type {BingoState,BingoGoal} from './bingo';
import {boardHit,points,type Hit} from './scoring';
import {DomainError} from './tournament';
export type DeckDifficulty='easy'|'mixed'|'hard';
export type DeckSettings={rounds:number;difficulty:DeckDifficulty;mode?:'dartdeck'|'bingo'|'tic-tac-toe'|'connect-four';bingoGoal?:BingoGoal;bingoSize?:4|8};
export type DeckPlayer={id:string;name:string;controllerId:string;accountId:string|null};
export type DeckCard={id:string;kind:'hits'|'set'|'at-least'|'exact'|'parity';targets:number[];count:number;multiplier?:1|2|3;value?:number;points:1|2|3};
const cards:DeckCard[]=[];
const add=(c:DeckCard)=>cards.push(c);
for(let n=1;n<=20;n++){
 for(const count of [1,2,3] as const)add({id:`sector-${n}-${count}`,kind:'hits',targets:[n],count,points:count});
 add({id:`single-${n}`,kind:'hits',targets:[n],count:1,multiplier:1,points:1});
 for(const multiplier of [2,3] as const)add({id:`field-${multiplier}-${n}`,kind:'hits',targets:[n],count:1,multiplier,points:3});
 if(n>1)add({id:`pair-${n}`,kind:'set',targets:[n,n-1],count:2,points:2});
 if(n>2)add({id:`run-${n}`,kind:'set',targets:[n,n-1,n-2],count:3,points:3});
}
for(let value=30;value<=150;value+=5)add({id:`total-min-${value}`,kind:'at-least',targets:[],count:3,value,points:value<=50?1:value<=90?2:3});
for(let value=10;value<=100;value+=5)add({id:`total-exact-${value}`,kind:'exact',targets:[],count:3,value,points:value<=30?2:3});
for(const count of [1,2,3] as const){
 add({id:`bull-${count}`,kind:'hits',targets:[25],count,points:count===1?2:3});
 for(const multiplier of [2,3] as const)add({id:`any-${multiplier}-${count}`,kind:'hits',targets:Array.from({length:20},(_,i)=>i+1),count,multiplier,points:count===1?2:3});
}
add({id:'double-bull',kind:'hits',targets:[25],count:1,multiplier:2,points:3});
for(const value of [0,1])add({id:`parity-${value}`,kind:'parity',targets:[],count:3,value,points:2});
for(const targets of [[20,1,18],[19,7,16],[18,4,13],[17,2,15],[16,8,11],[15,10,6],[14,9,12],[13,6,10],[12,5,20],[11,14,9]])add({id:'neighbors-'+targets.join('-'),kind:'set',targets,count:3,points:3});
export const deckCards:readonly DeckCard[]=cards;
const byId=new Map(cards.map(c=>[c.id,c]));
export function deckCard(id:string):DeckCard{const c=byId.get(id);if(!c)throw new DomainError('Unbekannte Aufgabenkarte.');return c;}
export function cardLabel(c:DeckCard,en=false){
 if(c.kind==='at-least')return en?`Score at least ${c.value} points.`:`Erziele mindestens ${c.value} Punkte.`;
 if(c.kind==='exact')return en?`Score exactly ${c.value} points. Confirm when ready.`:`Erziele genau ${c.value} Punkte. Bestätige, sobald es passt.`;
 if(c.kind==='set')return en?`Hit ${c.targets.join(', ')} once each, in any order.`:`Triff ${c.targets.join(', ')} jeweils einmal, Reihenfolge egal.`;
 if(c.kind==='parity')return en?`Hit three ${c.value?'odd':'even'} numbered sectors (1–20).`:`Triff dreimal ${c.value?'ungerade':'gerade'} Zahlenfelder (1–20).`;
 if(c.targets.length===20){const bed=c.multiplier===2?(en?'double':'Doppel'):(en?'triple':'Triple');return en?`Hit ${c.count} ${bed} field${c.count===1?'':'s'} (1–20), any numbers.`:`Triff ${c.count} ${bed}feld${c.count===1?'':'er'} (1–20), Zahlen frei wählbar.`;}
 const field=c.targets[0]===25?(c.multiplier===2?(en?'inner Bull (50)':'das innere Bull (50)'):(en?'Bull (25 or 50)':'Bull (25 oder 50)')):(c.multiplier===2?'D':c.multiplier===3?'T':c.multiplier===1?'S':'')+c.targets[0];
 return en?`Hit ${field} ${c.count===1?'once':c.count===2?'twice':'three times'}.`:`Triff ${field} ${c.count===1?'einmal':c.count===2?'zweimal':'dreimal'}.`;
}
export function cardAchieved(c:DeckCard,hits:Hit[]):boolean{
 if(c.kind==='hits')return hits.filter(h=>c.targets.includes(h.number)&&(!c.multiplier||h.multiplier===c.multiplier)).length>=c.count;
 if(c.kind==='set')return c.targets.every(n=>hits.some(h=>h.number===n));
 if(c.kind==='parity')return hits.length===3&&hits.every(h=>h.number>=1&&h.number<=20&&h.number%2===c.value);
 const total=hits.reduce((s,h)=>s+points(h),0);return c.kind==='exact'?total===c.value:total>=c.value!;
}
/** Difficulty follows the task, independently of its awarded points. */
export function cardDifficulty(c:DeckCard):'easy'|'medium'|'hard'{
 if(c.kind==='at-least')return c.value!<=60?'easy':c.value!<=100?'medium':'hard';
 if(c.kind==='exact')return c.value!<=20?'easy':c.value!<=60?'medium':'hard';
 if(c.kind==='set')return c.targets.length<3?'medium':'hard';
 if(c.kind==='parity')return 'medium';
 if(c.targets[0]===25)return c.count===1&&!c.multiplier?'medium':'hard';
 if(c.multiplier===3||c.multiplier===2&&c.targets.length<20)return 'hard';
 if(c.multiplier===2)return c.count===1?'medium':'hard';
 return c.count===1?'easy':c.count===2?'medium':'hard';
}
// Persisted `mixed` is retained for older rooms; its UI label is now Medium.
export function cardPool(difficulty:DeckDifficulty){return cards.filter(c=>difficulty==='easy'?cardDifficulty(c)==='easy':difficulty==='mixed'?cardDifficulty(c)!=='hard':cardDifficulty(c)!=='easy');}
export function shuffledDeck(difficulty:DeckDifficulty,randomInt:(n:number)=>number){const ids=cardPool(difficulty).map(c=>c.id);for(let i=ids.length-1;i>0;i--){const j=randomInt(i+1);[ids[i],ids[j]]=[ids[j],ids[i]];}return ids;}
export type DeckVisit={player:string;card:string;darts:Hit[];won:number;tempoBonus?:number;completedWith?:number};
export type DeckGame={connectFour?:ConnectFourState;history?:DeckResult[];startedAt?:string;finishedAt?:string;ticTacToe?:TicTacToeState;bingo?:BingoState;scoringVersion?:2|3;id:string;players:DeckPlayer[];settings:DeckSettings;phase:'playing'|'finished';active:number;cardId:string;deck:string[];draw:number;current:Hit[];visits:DeckVisit[];failures:number;bonus:number;votes:string[];skips:{player:string;card:string;darts:Hit[]}[];nonce:number};
export type PublicDeckGame=Omit<DeckGame,'deck'>;
export type DeckResult=Omit<PublicDeckGame,'history'>;
/** Version 2 and 3 differ only by a factor of four, so an entire game can
 * switch units without changing any player's relative score or awarded bonuses. */
export function wholePointGame<T extends PublicDeckGame>(game:T):T{
 if(game.scoringVersion!==2)return game;
 const converted=structuredClone(game);converted.scoringVersion=3;
 converted.visits=converted.visits.map(visit=>({...visit,won:visit.won*4,...(visit.tempoBonus!==undefined?{tempoBonus:visit.tempoBonus*4}:{})}));
 return converted;
}
export type DeckAction={type:'dart';hit:Hit;index?:number}|{type:'undo'}|{type:'next'}|{type:'vote-skip';agree:boolean;cardDraw:number;gameId:string};
export function createDeckGame(players:DeckPlayer[],settings:DeckSettings,deck:string[],id:string=globalThis.crypto.randomUUID()):DeckGame{
 if(!players.length||new Set(players.map(p=>p.id)).size!==players.length)throw new DomainError('Bitte unterschiedliche Spieler hinzufügen.');
 if(!Number.isInteger(settings.rounds)||settings.rounds<1||settings.rounds>50||!['easy','mixed','hard'].includes(settings.difficulty))throw new DomainError('Ungültige Spieleinstellungen.');
 const pool=cardPool(settings.difficulty).map(c=>c.id);if(deck.length!==pool.length||new Set(deck).size!==pool.length||deck.some(id=>!pool.includes(id)))throw new DomainError('Ungültiger Kartenstapel.');
 return {id,scoringVersion:3,players:structuredClone(players),settings:{...settings},phase:'playing',active:0,cardId:deck[0],deck:[...deck],draw:0,current:[],visits:[],failures:0,bonus:0,votes:[],skips:[],nonce:0};
}
/** Score the final corrected visit, using its earliest successful prefix.
 * Extra darts after success do not erase a bonus; an invalid final exact total earns nothing.
 * Missing scoringVersion retains the rules of an already-running legacy game. */
export function deckBasePoints(g:Pick<DeckGame,'cardId'|'bonus'|'scoringVersion'>){return (deckCard(g.cardId).points+g.bonus)*(g.scoringVersion===3?4:1);}
export function deckReward(g:Pick<DeckGame,'cardId'|'current'|'bonus'|'scoringVersion'>){
 const card=deckCard(g.cardId);
 if(!cardAchieved(card,g.current))return {total:0,base:0,tempo:0,completedWith:null};
 const completedWith=[1,2,3].find(n=>n<=g.current.length&&cardAchieved(card,g.current.slice(0,n)))??3;
 const base=deckBasePoints(g),tempo=g.scoringVersion===3?3-completedWith:g.scoringVersion===2?(3-completedWith)*.25:0;
 return {total:base+tempo,base,tempo,completedWith};
}
function drawCard(g:DeckGame){g.draw++;g.cardId=g.deck[g.draw%g.deck.length];g.failures=0;g.bonus=0;g.votes=[];g.nonce++;}
export function deckVisitKey(g:PublicDeckGame){return `${g.id}:${g.visits.length}:${g.nonce}`;}
export function deckAction(old:DeckGame,actor:string,action:DeckAction):DeckGame{
 if(old.phase!=='playing')throw new DomainError('Die Partie ist beendet.');
 if(!old.players.some(p=>p.id===actor))throw new DomainError('Nur Mitspieler dürfen abstimmen.');
 const g=structuredClone(wholePointGame(old));
 if(action.type==='vote-skip'){
  if(action.gameId!==g.id)throw new DomainError('Die Partie wurde inzwischen gewechselt.');
  if(action.cardDraw!==g.draw)throw new DomainError('Die Aufgabenkarte wurde inzwischen gewechselt.');
  g.votes=action.agree?[...new Set([...g.votes,actor])]:g.votes.filter(p=>p!==actor);
  if(g.players.every(p=>g.votes.includes(p.id))){g.skips.push({player:g.players[g.active].id,card:g.cardId,darts:g.current});g.current=[];drawCard(g);}return g;
 }
 if(g.players[g.active].id!==actor)throw new DomainError('Du bist gerade nicht an der Reihe.');
 if(action.type==='dart'){
  const h=action.hit,actual=boardHit(h.x,h.y);if(actual.number!==h.number||actual.multiplier!==h.multiplier)throw new DomainError('Treffer und Position stimmen nicht überein.');
  if(h.position)boardHit(h.position.x,h.position.y);
  const index=action.index??g.current.length;if(!Number.isInteger(index)||index<0||index>2||index>g.current.length)throw new DomainError('Dart-Reihenfolge ungültig.');
  g.current[index]=h;return g;
 }
 if(action.type==='undo'){g.current.pop();return g;}
 if(!g.current.length)throw new DomainError('Bitte zuerst einen Dart eintragen.');
 const reward=deckReward(g),won=reward.total;
 g.visits.push({player:actor,card:g.cardId,darts:g.current,won,...(g.scoringVersion&&won?{tempoBonus:reward.tempo,completedWith:reward.completedWith!}:{})});g.current=[];
 if(won)drawCard(g);else{g.failures++;if(g.failures>=g.players.length*2)drawCard(g);else if(g.failures>=g.players.length)g.bonus=1;}
 g.active=(g.active+1)%g.players.length;g.nonce++;
 if(g.visits.length>=g.players.length*g.settings.rounds){g.phase='finished';g.votes=[];}
 return g;
}
export function deckScores(g:PublicDeckGame){return g.players.map(p=>{const visits=g.visits.filter(v=>v.player===p.id);return {...p,score:visits.reduce((s,v)=>s+v.won,0),cards:visits.filter(v=>v.won>0).length,visits:visits.length,darts:visits.reduce((s,v)=>s+v.darts.length,0)+g.skips.filter(v=>v.player===p.id).reduce((s,v)=>s+v.darts.length,0)+(g.players[g.active].id===p.id?g.current.length:0)};});}
