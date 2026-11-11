import {createDeckGame,deckAction,shuffledDeck,type DeckAction,type DeckGame,type DeckPlayer,type DeckSettings,type PublicDeckGame} from './dartdeck';
import {DomainError} from './tournament';
import type {Hit} from './scoring';
export type BingoCell={number:number;multiplier?:2|3};
export type BingoState={boards:Record<string,BingoCell[]>;finishAt?:number;shared?:boolean;markAll?:boolean;draw?:boolean};
export type BingoGoal='one-line'|'two-lines'|'full-house';
const shuffle=<T>(items:T[],randomInt:(n:number)=>number)=>{const result=[...items];for(let i=result.length-1;i>0;i--){const j=randomInt(i+1);[result[i],result[j]]=[result[j],result[i]];}return result;};
export const bingoSize=(settings:DeckSettings)=>settings.bingoSize??4;
export const bingoLinesFor=(size:number)=>[...Array.from({length:size},(_,r)=>Array.from({length:size},(_,c)=>r*size+c)),...Array.from({length:size},(_,c)=>Array.from({length:size},(_,r)=>r*size+c)),Array.from({length:size},(_,i)=>i*size+i),Array.from({length:size},(_,i)=>i*size+size-1-i)];
export const isBingo=(g:Pick<DeckGame,'settings'>)=>g.settings.mode==='bingo';
export function createBingoGame(players:DeckPlayer[],settings:DeckSettings,randomInt:(n:number)=>number,id?:string):DeckGame{
 if(settings.mode!=='bingo'||![4,8].includes(bingoSize(settings))||settings.bingoGoal&&!['one-line','two-lines','full-house'].includes(settings.bingoGoal))throw new DomainError('Ungültige Bingo-Einstellungen.');
 const game=createDeckGame(players,settings,shuffledDeck(settings.difficulty,randomInt),id);
 const count=bingoSize(settings)**2,numbers=shuffle(Array.from({length:20},(_,i)=>i+1),randomInt);
 const targets:BingoCell[]=Array.from({length:count},(_,i)=>({number:numbers[i%20],...(settings.difficulty==='hard'?{multiplier:(i<count/2?2:3) as 2|3}:settings.difficulty==='mixed'&&i<count/4?{multiplier:2 as const}:{})}));
 const board=shuffle(targets,randomInt);game.bingo={markAll:true,boards:Object.fromEntries(players.map(p=>[p.id,structuredClone(board)]))};return game;
}
export function bingoProgress(g:PublicDeckGame,player:string,preview=true){
 const shared=!!g.bingo?.shared,board=g.bingo?.boards[shared?g.players[0].id:player];if(!board||board.length!==bingoSize(g.settings)**2)throw new DomainError('Bingofeld nicht verfügbar.');
 const marked=new Set<number>(),owners:(string|null)[]=Array(board.length).fill(null);const apply=(hits:Hit[],actor:string)=>{for(const hit of hits){if(g.bingo?.markAll){board.forEach((cell,index)=>{if(cell.number===hit.number&&(!cell.multiplier||cell.multiplier===hit.multiplier)){owners[index]=actor;if(actor===player)marked.add(index);}});continue;}const matches=(c:BingoCell,i:number)=>!owners[i]&&c.number===hit.number;let index=board.findIndex((c,i)=>matches(c,i)&&c.multiplier===hit.multiplier);if(index<0)index=board.findIndex((c,i)=>matches(c,i)&&!c.multiplier);if(index>=0){owners[index]=actor;if(actor===player)marked.add(index);}}};
 for(const visit of g.visits)if(shared||visit.player===player)apply(visit.darts,visit.player);
 const active=g.players[g.active].id;if(preview&&(shared||active===player))apply(g.current,active);
 const occupied=owners.flatMap((owner,i)=>owner?[i]:[]),allLines=bingoLinesFor(bingoSize(g.settings)),lines=allLines.filter(line=>line.every(i=>owners[i]===player)),possible=allLines.filter(line=>line.every(i=>!owners[i]||owners[i]===player)),goal=g.settings.bingoGoal??'two-lines';
 return {board,marked:[...marked],occupied,owners,lines,possible,complete:!g.bingo?.draw&&(goal==='full-house'?marked.size===board.length:lines.length>=(goal==='one-line'?1:2))};
}
export function bingoAction(old:DeckGame,actor:string,action:DeckAction):DeckGame{
 if(!old.bingo)throw new DomainError('Bingofeld nicht verfügbar.');
 if(action.type==='vote-skip')throw new DomainError('Bei Bingo gibt es keine Skip-Abstimmung.');
 if(action.type!=='next')return deckAction(old,actor,action);
 if(old.phase!=='playing')throw new DomainError('Die Partie ist beendet.');if(old.players[old.active].id!==actor)throw new DomainError('Du bist gerade nicht an der Reihe.');if(!old.current.length)throw new DomainError('Bitte zuerst einen Dart eintragen.');
 const game=structuredClone(old),before=bingoProgress(game,actor,false),after=bingoProgress(game,actor);
 game.visits.push({player:actor,card:'bingo',darts:game.current,won:after.marked.length-before.marked.length});game.current=[];
 if(after.complete&&!game.bingo!.finishAt)game.bingo!.finishAt=Math.ceil(game.visits.length/game.players.length)*game.players.length;
 if(game.bingo!.shared&&!game.bingo!.finishAt){const goal=game.settings.bingoGoal??'two-lines',needed=goal==='one-line'?1:2;const impossible=game.players.every(p=>{const progress=bingoProgress(game,p.id,false);return goal==='full-house'?progress.owners.some(owner=>owner!==null&&owner!==p.id):progress.possible.length<needed;});if(impossible){game.bingo!.draw=true;game.phase='finished';}}
 game.active=(game.active+1)%game.players.length;game.nonce++;
 if(game.bingo!.finishAt&&game.visits.length>=game.bingo!.finishAt)game.phase='finished';return game;
}
