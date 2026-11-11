import {isConnectFour,createConnectFour,connectFourAction} from './connect-four';
import {isTicTacToe,createTicTacToe,ticTacToeAction} from './tic-tac-toe';
import {createDeckGame,deckAction,deckScores,wholePointGame,shuffledDeck,type DeckAction,type DeckGame,type DeckPlayer,type DeckSettings,type PublicDeckGame} from './dartdeck';
import {bingoAction,bingoProgress,createBingoGame,isBingo} from './bingo';
export function createMinigame(players:DeckPlayer[],settings:DeckSettings,randomInt:(n:number)=>number,id?:string){const game=settings.mode==='connect-four'?createConnectFour(players,settings,randomInt,id):settings.mode==='tic-tac-toe'?createTicTacToe(players,settings,randomInt,id):settings.mode==='bingo'?createBingoGame(players,settings,randomInt,id):createDeckGame(players,settings,shuffledDeck(settings.difficulty,randomInt),id);game.startedAt=new Date().toISOString();return game;}
export function minigameAction(game:DeckGame,actor:string,action:DeckAction,randomInt:(n:number)=>number=n=>Math.floor(Math.random()*n)){const next=isConnectFour(game)?connectFourAction(game,actor,action,randomInt):isTicTacToe(game)?ticTacToeAction(game,actor,action,randomInt):isBingo(game)?bingoAction(game,actor,action):deckAction(game,actor,action);if(next.phase==='finished'&&game.phase!=='finished')next.finishedAt=new Date().toISOString();return next;}
export function minigameScores(game:PublicDeckGame){return deckScores(game).map(player=>{if(isConnectFour(game))return {...player,score:game.connectFour!.cells.filter(cell=>cell===player.id).length,lines:game.connectFour!.winner===player.id?1:0,complete:game.connectFour!.winner===player.id};if(isTicTacToe(game))return {...player,score:game.ticTacToe!.cells.filter(cell=>cell===player.id).length,lines:game.ticTacToe!.winner===player.id?1:0,complete:game.ticTacToe!.winner===player.id};if(!isBingo(game))return {...player,lines:0,complete:false};const progress=bingoProgress(game,player.id);return {...player,score:progress.marked.length,lines:progress.lines.length,complete:progress.complete};});}
export function minigameWinners(game:PublicDeckGame){const scores=minigameScores(game);return isBingo(game)||isTicTacToe(game)||isConnectFour(game)?scores.filter(p=>p.complete):scores.filter(p=>p.score===Math.max(...scores.map(s=>s.score)));}
export const minigameName=(settings:DeckSettings)=>settings.mode==='connect-four'?'Vier gewinnt':settings.mode==='tic-tac-toe'?'Tic-Tac-Toe':settings.mode==='bingo'?'Dart Bingo':'DartDeck';

export function withMinigameHistory(game:DeckGame,last:DeckGame|null){if(!last)return game;const {deck:_deck,history=[],...result}=last;game.history=[...history,wholePointGame(structuredClone(result))];return game;}

export const minigameDraw=(game:PublicDeckGame)=>!!(game.bingo?.draw||game.ticTacToe?.draw||game.connectFour?.draw);

export const minigameDartLimit=(game:PublicDeckGame)=>isConnectFour(game)||isTicTacToe(game)?1:3;
