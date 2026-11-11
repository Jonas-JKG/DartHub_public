import { describe,it,expect } from 'vitest';
import { BoardCursor,BoardStream,autodartsSlot,takeoutFinished,boardSnapshot,autodartsHit } from '../src/domain/autodarts';
import { createGame,gameAction,keypadHit,hitDistanceMm,bullWinner } from '../src/domain/scoring';
const simulatedBoard=(boardId:string,throws:ReturnType<typeof keypadHit>[])=>({channel:'autodarts.boards',topic:boardId+'.state',data:{numThrows:throws.length,throws:throws.map(h=>({segment:{number:h.number,multiplier:h.multiplier}}))}});
const dart=(n=20,m=3)=>({segment:{number:n,multiplier:m}});
describe('Autodarts pro Spieler',()=>{
  it('akzeptiert nur die eigene Scheibe und keine Matchdaten',()=>{
    const m=simulatedBoard('mine',[keypadHit(20,3)]);expect(boardSnapshot(m,'mine')).toEqual([dart()]);expect(boardSnapshot(m,'other')).toBeNull();
    expect(boardSnapshot({...m,channel:'autodarts.matches'},'mine')).toBeNull();expect(boardSnapshot({...m,topic:'mine.matches'},'mine')).toBeNull();
    expect(boardSnapshot(null,'mine')).toBeNull();expect(boardSnapshot({...m,data:{status:'Throw'}},'mine')).toBeNull();
  });
  it('übernimmt nur gültige Felder, Bulls und Fehlwürfe',()=>{
    expect(autodartsHit(dart())).toEqual(keypadHit(20,3));expect(autodartsHit(dart(25,2))).toEqual(keypadHit(25,2));expect(autodartsHit(dart(17,0))).toEqual(keypadHit(0,1));
    for(const x of [null,{},dart(21,1),dart(25,3),dart(1,-1),dart(1,4),dart(1.5,1),{segment:{number:'20',multiplier:3}}])expect(autodartsHit(x)).toBeNull();
  });
  it('importiert beim Verbinden keine alten Darts und jeden Slot höchstens einmal',()=>{
    const c=new BoardCursor();expect(c.accept([dart()],true)).toEqual([]);c.accept([],true);
    expect(c.accept([dart()],true)).toHaveLength(1);expect(c.accept([dart()],true)).toEqual([]);
    expect(c.accept([dart(1,1)],true)).toEqual([]);expect(c.accept([dart(1,1),dart()],true).map(v=>v.index)).toEqual([1]);
  });
  it('holt Würfe vom falschen Zug niemals nach und wartet bei herausgenommenen Darts',()=>{
    const c=new BoardCursor();c.accept([],false);expect(c.accept([dart()],false)).toEqual([]);expect(c.accept([dart()],true)).toEqual([]);
    expect(c.accept([dart(),dart()],true).map(v=>v.index)).toEqual([1]);expect(c.accept([dart()],true)).toEqual([]);expect(c.accept([dart(),dart(),dart()],true)).toEqual([]);
    c.accept([],true);expect(c.accept([dart()],true)).toHaveLength(1);
  });
  it('leere Scheibe verändert kein Spiel und löst niemals Weiter aus',()=>{
    let g=createGame(['a','b']);g=gameAction(g,'a',{type:'bull',hit:keypadHit(25,2)});g=gameAction(g,'b',{type:'bull',hit:keypadHit(25,1)});g=gameAction(g,'a',{type:'next'});g=gameAction(g,'b',{type:'next'});
    const c=new BoardCursor();c.accept([],true);
    for(const v of c.accept([dart(),dart(),dart()],true))g=gameAction(g,'a',{type:'dart',hit:v.hit});
    expect(g.current).toHaveLength(3);expect(g.turns).toHaveLength(0);const before=structuredClone(g);
    const snap=boardSnapshot({channel:'autodarts.boards',topic:'mine.events',data:{event:'Takeout finished'}},'mine');expect(c.accept(snap!,true)).toEqual([]);expect(g).toEqual(before);
  });
  it('ungültige oder zu große Aufnahmen blockieren statt Teilwerte einzutragen',()=>{
    const c=new BoardCursor();c.accept([],true);expect(c.accept([dart(),{}],true)).toEqual([]);expect(c.accept([dart(),dart()],true)).toEqual([]);c.accept([],true);expect(c.accept([dart(),dart(),dart(),dart()],true)).toEqual([]);
  });
});

// Recorded from a real V2.0.2 board, with IDs removed; first without a match, then vs a bot.
import recordings from './fixtures/autodarts-v2-board.json';
describe('echte V2 Board-Nachrichten',()=>{
  it.each([[0,[10,13,5,2,1,9]],[1,[20,20,20,20,3,1]]] as const)('übernimmt Aufnahme %i ohne offizielles Match-Abonnement', (index,expected)=>{
    const stream=new BoardStream(),cursor=new BoardCursor(),scores:number[]=[];
    for(const message of recordings[index]){const snapshot=stream.accept(message,'recorded-board');if(snapshot!==null)for(const dart of cursor.accept(snapshot,true))scores.push(dart.hit.number*dart.hit.multiplier);}
    expect(scores).toEqual(expected);
  });
  it('ignoriert fremde Boards und doppelte Events; Lücken werden nicht geraten',()=>{
    const stream=new BoardStream(),cursor=new BoardCursor();
    const event=(n:number,board='mine')=>({channel:'autodarts.boards',topic:board+'.events',data:{boardId:board,event:'Throw detected',throwNumber:n,throw:dart()}});
    expect(stream.accept(event(1,'other'),'mine')).toBeNull();
    cursor.accept(stream.accept({channel:'autodarts.boards',topic:'mine.state',data:{numThrows:0}},'mine')!,true);
    expect(cursor.accept(stream.accept(event(1),'mine')!,true)).toHaveLength(1);
    expect(stream.accept(event(1),'mine')).toBeNull();
    expect(cursor.accept(stream.accept(event(3),'mine')!,true)).toEqual([]);
    expect(stream.accept(event(2),'mine')).toBeNull();
  });
});

it('wechselt nur bei bestätigtem Herausziehen des eigenen Boards',()=>{
 const event=(name:string,board='mine')=>({channel:'autodarts.boards',topic:board+'.events',data:{boardId:board,event:name}});
 expect(takeoutFinished(event('Takeout finished'),'mine')).toBe(true);
 expect(takeoutFinished(event('Takeout finished','other'),'mine')).toBe(false);
 for(const name of ['Takeout started','Manual reset','Calibration finished','Throw detected'])expect(takeoutFinished(event(name),'mine')).toBe(false);
 expect(takeoutFinished({channel:'autodarts.boards',topic:'mine.state',data:{numThrows:0}},'mine')).toBe(false);
});

it('behält echte Koordinaten unabhängig von idealen Feldgrenzen und berechnet Bull-Abstände',()=>{
 const recorded={coords:{x:0.17375673616992748,y:0.5458705214212208},segment:{number:1,multiplier:3}};
 const hit=autodartsHit(recorded)!;
 expect(hit.number*hit.multiplier).toBe(3);expect(hit.position).toEqual({x:recorded.coords.x,y:-recorded.coords.y});
 const a=autodartsHit({coords:{x:.02,y:.12},segment:{number:20,multiplier:1}})!;
 const b=autodartsHit({coords:{x:.04,y:.2},segment:{number:20,multiplier:1}})!;
 expect(hitDistanceMm(a)).toBeCloseTo(Math.hypot(.02,.12)*170);expect(bullWinner(a,b)).toBe(0);
 const bulls=[.001,.02].map(x=>autodartsHit({coords:{x,y:0},segment:{number:25,multiplier:2}})!);
 expect(bullWinner(bulls[0],bulls[1])).toBeNull();
 for(const coords of [{x:NaN,y:0},{x:0,y:Infinity},{x:3,y:0},{x:'0',y:0},null])expect(autodartsHit({coords,segment:{number:20,multiplier:1}})).toBeNull();
});

it('appends the two real hits after an off-turn false miss without inventing or overwriting a dart',()=>{
 const stream=new BoardStream(),cursor=new BoardCursor(),event=(n:number,number:number)=>({channel:'autodarts.boards',topic:'mine.events',data:{event:'Throw detected',throwNumber:n,throw:dart(number,number?1:0)}});
 cursor.accept([],false);cursor.accept(stream.accept(event(1,0),'mine')!,false);
 const imported:ReturnType<typeof keypadHit>[]=[];
 for(const [n,number] of [[2,20],[3,19]])for(const d of cursor.accept(stream.accept(event(n,number),'mine')!,true)){const slot=autodartsSlot(d.index,imported.length);expect(slot).toBe(imported.length);imported[slot!]=d.hit;}
 expect(imported.map(h=>h.number)).toEqual([20,19]);expect(stream.accept(event(3,19),'mine')).toBeNull();
 expect(autodartsSlot(1,0)).toBe(0);expect(autodartsSlot(2,1)).toBe(1);expect(autodartsSlot(0,1)).toBeNull();expect(autodartsSlot(2,3)).toBeNull();for(const invalid of [-1,3,NaN,.5])expect(autodartsSlot(invalid,0)).toBeNull();
});
