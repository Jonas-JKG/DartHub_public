import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createTournament,createTournamentLobby,drawTournamentLobby,rulesForMatch} from '../src/domain/tournament';
import {createGame,gameAction,keypadHit,type Game} from '../src/domain/scoring';
const scoring={start:301 as const,out:'single' as const,legsToWin:2,groupLegsToWin:1};
const input={id:randomUUID(),name:'Group cup',names:['A','B','C','D','E','F','G','H'],mode:'groups' as const,groupSize:4,advancePerGroup:2,scoring};
function winLeg(g:Game){const actor=g.players[g.starter??0];for(const [number,multiplier] of [[20,3],[20,3],[20,3]])g=gameAction(g,actor,{type:'dart',hit:keypadHit(number,multiplier as 3)});g=gameAction(g,actor,{type:'next'});const other=g.players.find(p=>p!==actor)!;g=gameAction(g,other,{type:'dart',hit:keypadHit(0,1)});g=gameAction(g,other,{type:'next'});for(const hit of [keypadHit(20,3),keypadHit(20,3),keypadHit(1,1)])g=gameAction(g,actor,{type:'dart',hit});return gameAction(g,actor,{type:'next'});}
it('group and knockout matches use their own leg targets, preserved through the tournament lobby',()=>{
 const t=drawTournamentLobby(createTournamentLobby(input,randomUUID),()=>0);
 expect(t.scoring).toEqual(scoring);expect(t.matches.filter(m=>m.phase==='group').every(m=>rulesForMatch(t,m).legsToWin===1)).toBe(true);
 for(const phase of ['group','knockout'] as const){
  let g=createGame(['A','B'],rulesForMatch(t,{phase}));g=gameAction(g,'A',{type:'bull',hit:keypadHit(25,2)});g=gameAction(g,'B',{type:'bull',hit:keypadHit(25,1)});g=gameAction(g,'A',{type:'next'});g=gameAction(g,'B',{type:'next'});
  const before=g.rules;g=winLeg(g);expect(g.phase).toBe(phase==='group'?'finished':'playing');expect(g.rules).toEqual(before);
 }
 expect(scoring.legsToWin).toBe(2);
});
it('existing tournaments without a group override keep the previous target in both phases',()=>{
 const t=createTournament({...input,scoring:{start:501,out:'double',legsToWin:3}},()=>0,randomUUID);
 expect(rulesForMatch(t,{phase:'group'}).legsToWin).toBe(3);expect(rulesForMatch(t,{phase:'knockout'}).legsToWin).toBe(3);
});
