import {createDeckGame,deckAction,shuffledDeck,type DeckGame,type DeckPlayer,type DeckSettings,type DeckAction,type PublicDeckGame} from './dartdeck';
import type {BingoCell} from './bingo';
import {DomainError} from './tournament';
export type TicTacToeState={targets:BingoCell[];cells:(string|null)[];winner?:string;draw?:boolean};
export const isTicTacToe=(g:Pick<DeckGame,'settings'>)=>g.settings.mode==='tic-tac-toe';
export const ticTacToeLines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
export function boardGameTargets(settings:DeckSettings,randomInt:(n:number)=>number,count=9):BingoCell[]{const numbers=Array.from({length:20},(_,i)=>i+1);for(let i=19;i>0;i--){const j=randomInt(i+1);[numbers[i],numbers[j]]=[numbers[j],numbers[i]];}return numbers.slice(0,count).map((number,i)=>({number,...(settings.difficulty==='hard'?{multiplier:(i<Math.ceil(count/2)?2:3) as 2|3}:settings.difficulty==='mixed'&&i<Math.ceil(count/3)?{multiplier:2 as const}:{})}));}
export function createTicTacToe(players:DeckPlayer[],settings:DeckSettings,randomInt:(n:number)=>number,id?:string){if(players.length!==2)throw new DomainError('Tic-Tac-Toe benötigt genau zwei Spieler.');const game=createDeckGame(players,settings,shuffledDeck(settings.difficulty,randomInt),id);game.ticTacToe={targets:boardGameTargets(settings,randomInt),cells:Array(9).fill(null)};return game;}
export function ticTacToeView(game:PublicDeckGame){const board=game.ticTacToe;if(!board)throw new DomainError('Spielfeld nicht verfügbar.');let claim=-1;for(const hit of game.current){claim=board.targets.findIndex((target,i)=>!board.cells[i]&&target.number===hit.number&&(!target.multiplier||target.multiplier===hit.multiplier));if(claim>=0)break;}return {...board,claim};}
export function ticTacToeAction(old:DeckGame,actor:string,action:DeckAction,randomInt:(n:number)=>number):DeckGame{
 if(action.type==='vote-skip')throw new DomainError('Bei Tic-Tac-Toe gibt es keine Skip-Abstimmung.');
 if(old.phase!=='playing')throw new DomainError('Die Partie ist beendet.');if(old.players[old.active].id!==actor)throw new DomainError('Du bist gerade nicht an der Reihe.');
 if(action.type!=='next'){if(action.type==='dart'&&(action.index===undefined||action.index===old.current.length)&&old.current.length>=1)throw new DomainError('Nur ein Dart pro Zug. Bitte Weiter drücken oder korrigieren.');return deckAction(old,actor,action);}
 if(!old.current.length)throw new DomainError('Bitte zuerst einen Dart eintragen.');const game=structuredClone(old),board=game.ticTacToe!,claim=ticTacToeView(game).claim;
 if(claim>=0)board.cells[claim]=actor;game.visits.push({player:actor,card:'tic-tac-toe',darts:game.current,won:claim>=0?1:0});game.current=[];game.nonce++;
 if(ticTacToeLines.some(line=>line.every(i=>board.cells[i]===actor))){board.winner=actor;game.phase='finished';}else if(board.cells.every(Boolean)){board.draw=true;game.phase='finished';}
 if(game.phase==='playing'){game.active=1-game.active;if(game.visits.length%2===0){const free=board.cells.flatMap((cell,i)=>cell?[]:[i]);const values=boardGameTargets(game.settings,randomInt);free.forEach((cell,i)=>board.targets[cell]=values[i]);}}
 return game;
}
