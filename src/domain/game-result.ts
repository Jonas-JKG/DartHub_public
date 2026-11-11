import {gameView,type Game} from './scoring';
import {updateMatch,type Tournament} from './tournament';
/** Two-seat games must retain a valid score even before the multiplayer migration. */
export function completedGameTournament(t:Tournament,matchId:string,g:Game):Tournament {
 const view=gameView(g);
 if(g.practice==='around-clock'&&g.players.length>2){
  const winner=g.players[view.active];
  return {...t,status:'completed',winner,matches:t.matches.map(m=>m.id===matchId?{...m,status:'finished',winner,legs:[null,null]}:m)};
 }
 return updateMatch(t,matchId,{legs:[view.legs[0],view.legs[1]],status:'finished',forfeited:null}).tournament;
}
