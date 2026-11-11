import {it,expect} from 'vitest';
import {cardAchieved,wholePointGame,deckReward,deckCards,cardPool,cardDifficulty,createDeckGame,deckAction,deckVisitKey,deckScores,shuffledDeck,type DeckGame,type DeckPlayer} from '../src/domain/dartdeck';
import {keypadHit,type Hit} from '../src/domain/scoring';
const roster=(n:number):DeckPlayer[]=>Array.from({length:n},(_,i)=>({id:'p'+i,name:'Player '+i,controllerId:'a'+i,accountId:'a'+i}));
function game(n=3,rounds=10,first='sector-20-1'){const pile=shuffledDeck('mixed',()=>0);pile.splice(pile.indexOf(first),1);pile.unshift(first);return createDeckGame(roster(n),{rounds,difficulty:'mixed'},pile);}
const miss=(g:DeckGame)=>deckAction(deckAction(g,g.players[g.active].id,{type:'dart',hit:keypadHit(0,1)}),g.players[g.active].id,{type:'next'});
it('contains over 200 semantically different, achievable original cards',()=>{
 expect(deckCards.length).toBeGreaterThanOrEqual(200);expect(new Set(deckCards.map(c=>c.id)).size).toBe(deckCards.length);
 expect(new Set(deckCards.map(({id:_id,points:_points,...rule})=>JSON.stringify({...rule,targets:[...rule.targets].sort((a,b)=>a-b)}))).size).toBe(deckCards.length);
 const legal=[keypadHit(0,1),keypadHit(25,1),keypadHit(25,2),...Array.from({length:20},(_,i)=>i+1).flatMap(n=>[keypadHit(n,1),keypadHit(n,2),keypadHit(n,3)])];
 for(const c of deckCards){let hits:Hit[]=[];
  if(c.kind==='hits')hits=Array.from({length:c.count},()=>keypadHit(c.targets[0],c.multiplier??1));
  if(c.kind==='set')hits=c.targets.map(n=>keypadHit(n,1));
  if(c.kind==='parity')hits=Array.from({length:3},()=>keypadHit(c.value===0?2:1,1));
  if(c.kind==='at-least')hits=[keypadHit(20,3),keypadHit(20,3),keypadHit(20,3)];
  if(c.kind==='exact'){outer:for(const a of legal)for(const b of legal)for(const d of legal)if(a.number*a.multiplier+b.number*b.multiplier+d.number*d.multiplier===c.value){hits=[a,b,d];break outer;}}
  expect(hits.length,c.id).toBeLessThanOrEqual(3);expect(cardAchieved(c,hits),c.id).toBe(true);expect(cardAchieved(c,[]),c.id).toBe(false);
 }
});
it('shuffle has no duplicates and filters difficulty without a six-player cap',()=>{
 for(const difficulty of ['easy','mixed','hard'] as const){const pile=shuffledDeck(difficulty,()=>0);expect(new Set(pile).size).toBe(cardPool(difficulty).length);expect(pile.every(id=>cardPool(difficulty).some(c=>c.id===id))).toBe(true);}
 expect(game(80).players).toHaveLength(80);
});
it('a failed card passes to the next player; winning awards the card and draws for the next player',()=>{
 let g=miss(game());expect(g.active).toBe(1);expect(g.cardId).toBe('sector-20-1');
 g=deckAction(g,'p1',{type:'dart',hit:keypadHit(20,3)});g=deckAction(g,'p1',{type:'next'});expect(g.active).toBe(2);expect(g.cardId).not.toBe('sector-20-1');expect(deckScores(g)[1]).toMatchObject({score:6,cards:1});
});
it('a full failed cycle adds one bonus, two cycles replace the card',()=>{
 let g=game();for(let i=0;i<3;i++)g=miss(g);expect(g.bonus).toBe(1);expect(g.cardId).toBe('sector-20-1');
 const won=deckAction(deckAction(g,'p0',{type:'dart',hit:keypadHit(20,1)}),'p0',{type:'next'});expect(deckScores(won)[0].score).toBe(10);
 for(let i=0;i<3;i++)g=miss(g);expect(g.cardId).not.toBe('sector-20-1');expect(g.bonus).toBe(0);
});
it('unanimous skip draws once, keeps the active player, resets darts and invalidates old takeout keys',()=>{
 let g=game(7);g=deckAction(g,'p0',{type:'dart',hit:keypadHit(1,1)});const key=deckVisitKey(g),card=g.cardId;
 for(let i=0;i<6;i++)g=deckAction(g,'p'+i,{type:'vote-skip',agree:true,cardDraw:0,gameId:g.id});expect(g.cardId).toBe(card);expect(g.current).toHaveLength(1);
 g=deckAction(g,'p6',{type:'vote-skip',agree:true,cardDraw:0,gameId:g.id});expect(g.cardId).not.toBe(card);expect(g.active).toBe(0);expect(g.visits).toHaveLength(0);expect(g.current).toEqual([]);expect(g.votes).toEqual([]);expect(deckVisitKey(g)).not.toBe(key);expect(deckScores(g)[0].darts).toBe(1);
 expect(()=>deckAction(g,'p0',{type:'vote-skip',agree:true,cardDraw:0,gameId:g.id})).toThrow('gewechselt');
});
it('votes are idempotent, retractable, card scoped and limited to participants',()=>{
 let g=game();const vote={type:'vote-skip',agree:true,cardDraw:0,gameId:g.id} as const;g=deckAction(g,'p2',vote);g=deckAction(g,'p2',vote);expect(g.votes).toEqual(['p2']);g=miss(g);expect(g.votes).toEqual(['p2']);g=deckAction(g,'p2',{...vote,agree:false});expect(g.votes).toEqual([]);expect(()=>deckAction(g,'stranger',vote)).toThrow();
});
it('players get equal turns and a finished result cannot be changed',()=>{
 let g=game(3,2);for(let i=0;i<6;i++)g=miss(g);expect(g.phase).toBe('finished');expect(deckScores(g).map(s=>s.visits)).toEqual([2,2,2]);expect(()=>miss(g)).toThrow('beendet');
});
it('three-dart limit, corrections, field validation and turn ownership are enforced',()=>{
 let g=game();expect(()=>deckAction(g,'p1',{type:'dart',hit:keypadHit(20,1)})).toThrow('Reihe');expect(()=>deckAction(g,'p0',{type:'dart',hit:{...keypadHit(20,1),number:19}})).toThrow('Position');
 for(let i=0;i<3;i++)g=deckAction(g,'p0',{type:'dart',hit:keypadHit(20,1)});expect(()=>deckAction(g,'p0',{type:'dart',hit:keypadHit(20,1)})).toThrow('Reihenfolge');g=deckAction(g,'p0',{type:'dart',hit:keypadHit(0,1),index:1});expect(g.current[1].number).toBe(0);g=deckAction(g,'p0',{type:'undo'});expect(g.current).toHaveLength(2);
});

it('late votes and takeout keys from the previous game cannot affect a rematch',()=>{
 const old=game(),next=game();expect(deckVisitKey(old)).not.toBe(deckVisitKey(next));expect(()=>deckAction(next,'p0',{type:'vote-skip',agree:true,cardDraw:0,gameId:old.id})).toThrow('Partie');
});

it('medium excludes exact high finishes and repeated triples; easy includes achievable sixty-point targets',()=>{
 const easy=cardPool('easy'),medium=cardPool('mixed'),hard=cardPool('hard');
 expect(easy.some(c=>c.id==='total-min-60')).toBe(true);expect(medium.some(c=>c.id==='total-min-100')).toBe(true);expect(medium.some(c=>c.id==='total-exact-60')).toBe(true);
 for(const id of ['total-exact-100','field-3-20','any-3-3','bull-3','total-min-150']){expect(medium.some(c=>c.id===id),id).toBe(false);expect(hard.some(c=>c.id===id),id).toBe(true);}
 expect(medium.every(c=>cardDifficulty(c)!=='hard')).toBe(true);expect(easy.every(c=>medium.some(m=>m.id===c.id))).toBe(true);
});

it('a one-hit card earns a modest bonus for completing on dart one or two',()=>{
 for(const [darts,score,tempo] of [[1,6,2],[2,5,1],[3,4,0]]){let g=game();for(let i=1;i<darts;i++)g=deckAction(g,'p0',{type:'dart',hit:keypadHit(0,1)});g=deckAction(g,'p0',{type:'dart',hit:keypadHit(20,1)});expect(deckReward(g)).toMatchObject({total:score,tempo,completedWith:darts});g=deckAction(g,'p0',{type:'next'});expect(g.visits[0]).toMatchObject({won:score,tempoBonus:tempo,completedWith:darts});expect(deckScores(g)[0].score).toBe(score);}
});
it('two- and three-hit cards keep their higher base value and award only possible early completion',()=>{
 for(const [card,hits,score,tempo] of [['sector-20-2',[20,20],9,1],['sector-20-2',[0,20,20],8,0],['sector-20-3',[20,20,20],12,0]] as const){let g=game(3,10);g.cardId=card;for(const hit of hits)g=deckAction(g,'p0',{type:'dart',hit:keypadHit(hit,1)});expect(deckReward(g)).toMatchObject({total:score,tempo});}
});
it('extra darts after success preserve the first completion, while corrections recompute it',()=>{
 let g=game();for(const hit of [20,0,20])g=deckAction(g,'p0',{type:'dart',hit:keypadHit(hit,1)});expect(deckReward(g)).toMatchObject({total:6,completedWith:1});g=deckAction(g,'p0',{type:'dart',index:0,hit:keypadHit(0,1)});expect(deckReward(g)).toMatchObject({total:4,tempo:0,completedWith:3});g=deckAction(g,'p0',{type:'undo'});expect(deckReward(g).total).toBe(0);g=deckAction(g,'p0',{type:'dart',index:1,hit:keypadHit(20,1)});expect(deckReward(g)).toMatchObject({total:5,completedWith:2});
});
it('exact totals must remain valid at confirmation; only the speed bonus, not points, counts unused darts',()=>{
 let g=game(3,10,'total-exact-20');g=deckAction(g,'p0',{type:'dart',hit:keypadHit(20,1)});expect(deckReward(g)).toMatchObject({total:10,completedWith:1});g=deckAction(g,'p0',{type:'dart',hit:keypadHit(5,1)});expect(deckReward(g).total).toBe(0);g=deckAction(g,'p0',{type:'dart',index:1,hit:keypadHit(0,1)});expect(deckReward(g)).toMatchObject({total:10,completedWith:1});
});
it('running legacy games and saved results retain their original scores',()=>{
 let g=game();delete g.scoringVersion;g=deckAction(g,'p0',{type:'dart',hit:keypadHit(20,1)});expect(deckReward(g)).toMatchObject({total:1,tempo:0});g=deckAction(g,'p0',{type:'next'});expect(g.visits[0]).toMatchObject({won:1});expect(g.visits[0]).not.toHaveProperty('tempoBonus');expect(deckScores(g)[0].score).toBe(1);
});

it('existing fractional games are converted without changing relative scores, and conversion is idempotent',()=>{
 const old=game();old.scoringVersion=2;old.visits=[{player:'p0',card:'sector-20-1',darts:[keypadHit(20,1)],won:1.5,tempoBonus:.5,completedWith:1},{player:'p1',card:'sector-20-1',darts:[keypadHit(0,1),keypadHit(20,1)],won:1.25,tempoBonus:.25,completedWith:2}];const converted=wholePointGame(old);expect(old.scoringVersion).toBe(2);expect(converted.scoringVersion).toBe(3);expect(converted.visits.map(v=>v.won)).toEqual([6,5]);expect(converted.visits.map(v=>v.tempoBonus)).toEqual([2,1]);expect(wholePointGame(converted)).toEqual(converted);const continued=deckAction(old,'p0',{type:'dart',hit:keypadHit(20,1)});expect(continued.scoringVersion).toBe(3);expect(deckReward(continued).total).toBe(6);expect(game().scoringVersion).toBe(3);
 for(const card of deckCards){const g=game();g.cardId=card.id;for(const hits of [[keypadHit(20,1)],[keypadHit(20,1),keypadHit(20,1)],[keypadHit(20,1),keypadHit(20,1),keypadHit(20,1)]]){g.current=hits;expect(Number.isInteger(deckReward(g).total)).toBe(true);}}
});
