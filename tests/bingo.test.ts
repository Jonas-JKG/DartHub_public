import {it,expect} from 'vitest';
import {createBingoGame,bingoAction,bingoProgress} from '../src/domain/bingo';
import {minigameAction,minigameWinners,minigameScores} from '../src/domain/minigames';
import {DeckEffectTracker} from '../src/client/dartdeck-effects';
import {keypadHit} from '../src/domain/scoring';
import type {DeckGame,DeckSettings} from '../src/domain/dartdeck';
const players=(n:number)=>Array.from({length:n},(_,i)=>({id:'p'+i,name:'Player '+i,controllerId:'a'+i,accountId:'a'+i}));
function rng(){let seed=715;return (n:number)=>{seed=(seed*16807)%2147483647;return seed%n;};}
function game(n=3,goal:DeckSettings['bingoGoal']='two-lines'){const g=createBingoGame(players(n),{mode:'bingo',rounds:1,difficulty:'easy',bingoGoal:goal},rng());g.bingo!.shared=false;delete g.bingo!.markAll;for(const player of g.players)g.bingo!.boards[player.id]=Array.from({length:16},(_,i)=>({number:i+1}));return g;}
function hit(g:DeckGame,n:number,m:1|2|3=1){return minigameAction(g,g.players[g.active].id,{type:'dart',hit:keypadHit(n,m)});}
function next(g:DeckGame){return minigameAction(g,g.players[g.active].id,{type:'next'});}
it('everyone gets the same sixteen unique targets in one common layout, at the selected difficulty',()=>{
 for(const difficulty of ['easy','mixed','hard'] as const){const g=createBingoGame(players(8),{mode:'bingo',rounds:10,difficulty},rng()),boards=Object.values(g.bingo!.boards);for(const board of boards){expect(board).toHaveLength(16);expect(new Set(board.map(c=>c.number)).size).toBe(16);expect(board.map(c=>JSON.stringify(c)).sort()).toEqual(boards[0].map(c=>JSON.stringify(c)).sort());}expect(boards[0]).toEqual(boards[1]);expect(boards[0].filter(c=>c.multiplier===2)).toHaveLength(difficulty==='easy'?0:difficulty==='mixed'?4:8);expect(boards[0].filter(c=>c.multiplier===3)).toHaveLength(difficulty==='hard'?8:0);}
});
it('one dart marks at most one target, repeats do not score, and corrections/undo recalculate the preview',()=>{
 let g=game();g=hit(g,1,3);g=hit(g,1);expect(bingoProgress(g,'p0').marked).toEqual([0]);expect(bingoProgress(g,'p1').marked).toEqual([]);g=bingoAction(g,'p0',{type:'dart',index:0,hit:keypadHit(2,1)});expect(bingoProgress(g,'p0').marked.sort()).toEqual([0,1]);g=bingoAction(g,'p0',{type:'undo'});expect(bingoProgress(g,'p0').marked).toEqual([1]);g=next(g);expect(g.visits[0].won).toBe(1);expect(minigameScores(g)[0].score).toBe(1);
});
it('double and triple cells require their exact ring and invalid/out-of-turn actions are rejected',()=>{
 let g=game();g.bingo!.boards.p0[0].multiplier=2;g.bingo!.boards.p0[1].multiplier=3;g=hit(g,1);expect(bingoProgress(g,'p0').marked).toEqual([]);g=hit(g,1,2);g=hit(g,2,2);expect(bingoProgress(g,'p0').marked).toEqual([0]);expect(()=>hit(g,2,3)).toThrow('Reihenfolge');expect(()=>bingoAction(g,'p1',{type:'undo'})).toThrow('Reihe');expect(()=>bingoAction(g,'p0',{type:'vote-skip',agree:true,cardDraw:0,gameId:g.id})).toThrow('Skip');
});
it('completed horizontal, vertical and diagonal lines count without double-counting their intersection',()=>{
 const g=game();g.visits=[{player:'p0',card:'bingo',darts:[1,2,3].map(n=>keypadHit(n,1)),won:3},{player:'p0',card:'bingo',darts:[4,5,9].map(n=>keypadHit(n,1)),won:3}];g.current=[keypadHit(13,1)];expect(bingoProgress(g,'p0')).toMatchObject({complete:true});expect(bingoProgress(g,'p0').marked).toHaveLength(7);expect(bingoProgress(g,'p0').lines).toHaveLength(2);g.visits=[];g.current=[];g.visits.push({player:'p0',card:'bingo',darts:[1,6,11,16].map(n=>keypadHit(n,1)),won:4});expect(bingoProgress(g,'p0').lines).toEqual([[0,5,10,15]]);
});
it('the whole round finishes after first bingo, ignoring card-game round limits and allowing shared winners',()=>{
 let g=game(3,'one-line');for(let i=0;i<3;i++){for(const n of [1,2,3])g=hit(g,n);g=next(g);}expect(g.phase).toBe('playing');for(let i=0;i<3;i++){g=hit(g,4);g=next(g);expect(g.bingo!.finishAt).toBe(6);expect(g.phase).toBe(i===2?'finished':'playing');}expect(minigameWinners(g)).toHaveLength(3);expect(g.visits).toHaveLength(6);expect(()=>next(g)).toThrow('beendet');
});
it('full house requires all cells, and winners are based on bingo rather than the largest number of marks',()=>{
 const g=game(2,'one-line');g.phase='finished';g.visits=[{player:'p0',card:'bingo',darts:[1,2,3,4].map(n=>keypadHit(n,1)),won:4},{player:'p1',card:'bingo',darts:[1,2,7,8,9,10].map(n=>keypadHit(n,1)),won:6}];expect(minigameWinners(g).map(p=>p.id)).toEqual(['p0']);g.settings.bingoGoal='full-house';expect(bingoProgress(g,'p0').complete).toBe(false);g.visits.push({player:'p0',card:'bingo',darts:Array.from({length:16},(_,i)=>keypadHit(i+1,1)),won:12});expect(bingoProgress(g,'p0').complete).toBe(true);
});
it('bingo sounds follow useful marks and completed lines, with no phantom card/skip effects',()=>{
 const tracker=new DeckEffectTracker();let g=game(1,'one-line');tracker.update(g);g=hit(g,1);expect(tracker.update(g)).toEqual(['target']);g=hit(g,1);expect(tracker.update(g)).toEqual(['hit']);g=hit(g,0);expect(tracker.update(g)).toEqual(['miss']);g=next(g);expect(tracker.update(g)).toEqual(['turn']);for(const n of [2,3,4]){g=hit(g,n);const effects=tracker.update(g);expect(effects).toEqual([n===4?'success':'target']);}g=next(g);expect(tracker.update(g)).toEqual(['finish']);expect(tracker.update(g)).toEqual([]);
});
it('8×8 shares 64 balanced targets, scales the difficulty, and rejects unsupported sizes',()=>{
 for(const difficulty of ['easy','mixed','hard'] as const){const g=createBingoGame(players(3),{mode:'bingo',rounds:10,difficulty,bingoSize:8},rng()),boards=Object.values(g.bingo!.boards);for(const board of boards){expect(board).toHaveLength(64);expect(board.map(c=>JSON.stringify(c)).sort()).toEqual(boards[0].map(c=>JSON.stringify(c)).sort());expect(board.filter(c=>c.multiplier===2)).toHaveLength(difficulty==='easy'?0:difficulty==='mixed'?16:32);expect(board.filter(c=>c.multiplier===3)).toHaveLength(difficulty==='hard'?32:0);}expect(boards[0]).toEqual(boards[1]);}
 expect(()=>createBingoGame(players(1),{mode:'bingo',rounds:1,difficulty:'easy',bingoSize:7 as 8},rng())).toThrow('Einstellungen');
});
it('8×8 needs eight marked cells per line and all 64 for full house, one duplicate per dart',()=>{
 const g=createBingoGame(players(1),{mode:'bingo',rounds:1,difficulty:'easy',bingoSize:8,bingoGoal:'one-line'},rng());delete g.bingo!.markAll;g.bingo!.boards.p0=Array.from({length:64},()=>({number:20}));
 const mark=(n:number)=>{g.visits=[{player:'p0',card:'bingo',darts:Array.from({length:n},()=>keypadHit(20,1)),won:n}];return bingoProgress(g,'p0');};
 expect(mark(1).marked).toHaveLength(1);expect(mark(7).complete).toBe(false);expect(mark(8).lines).toEqual([[0,1,2,3,4,5,6,7]]);g.settings.bingoGoal='full-house';expect(mark(63).complete).toBe(false);expect(mark(64)).toMatchObject({complete:true});expect(mark(64).lines).toHaveLength(18);expect(mark(65).marked).toHaveLength(64);
});
it('duplicate matching reserves an exact ring target before an unrestricted one and remains reversible',()=>{
 let g=createBingoGame(players(1),{mode:'bingo',rounds:1,difficulty:'easy',bingoSize:8},rng());delete g.bingo!.markAll;g.bingo!.boards.p0=Array.from({length:64},()=>({number:1}));g.bingo!.boards.p0[1]={number:1,multiplier:2};g=hit(g,1,2);expect(bingoProgress(g,'p0').marked).toEqual([1]);g=hit(g,1);expect(bingoProgress(g,'p0').marked).toEqual([1,0]);g=bingoAction(g,'p0',{type:'dart',index:0,hit:keypadHit(0,1)});expect(bingoProgress(g,'p0').marked).toEqual([0]);g=bingoAction(g,'p0',{type:'undo'});expect(bingoProgress(g,'p0').marked).toEqual([]);
});
