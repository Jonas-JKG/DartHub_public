import { describe, expect, it } from 'vitest';
import { boardHit, bullWinner, checkout, recommendation, createGame, defaultRules, gameAction, gameView, hitLabel, keypadHit, points, visit, sectors, type Game } from '../src/domain/scoring';
const a='player-a',b='player-b',h=keypadHit;
function playing(start:301|501|701=301,legsToWin=2):Game {
  let g=createGame([a,b],{start,out:'double',legsToWin});
  g=gameAction(g,a,{type:'bull',hit:h(25,2)});g=gameAction(g,b,{type:'bull',hit:h(25,1)});g=gameAction(g,a,{type:'next'});return gameAction(g,b,{type:'next'});
}
describe('Dartscheibe und Eingaben',()=>{
  for(const n of sectors)for(const m of [1,2,3] as const)it(`Feld ${m} × ${n}: Tastatur und Scheibe stimmen überein`,()=>{
    const dart=h(n,m);expect(boardHit(dart.x,dart.y)).toEqual(dart);expect(points(dart)).toBe(n*m);
  });
  it('20 steht oben; Bull und äußere Felder haben richtige Grenzen',()=>{
    expect(boardHit(0,-103/170)).toMatchObject({number:20,multiplier:3});
    expect(boardHit(0,-166/170)).toMatchObject({number:20,multiplier:2});
    expect(points(boardHit(0,0))).toBe(50);expect(points(boardHit(10/170,0))).toBe(25);
    expect(points(boardHit(1.1,0))).toBe(0);
  });
  it('manipulierte Felder und unmögliche Tastaturwerte werden abgelehnt',()=>{
    expect(()=>h(25,3)).toThrow();expect(()=>h(21,1)).toThrow();
    expect(()=>gameAction(playing(),a,{type:'dart',hit:{...h(20,1),number:19}})).toThrow();
  });
});
describe('Ausbullen',()=>{
  it('Bull gewinnt gegen 25 und Außenfeld; gleiche Bull-Treffer wiederholen sich unabhängig vom Abstand',()=>{
    expect(bullWinner(h(25,2),h(25,1))).toBe(0);
    expect(bullWinner(h(25,1),h(20,3))).toBe(0);
    expect(bullWinner(boardHit(0,0),boardHit(3/170,0))).toBeNull();
    expect(bullWinner(boardHit(8/170,0),boardHit(14/170,0))).toBeNull();
    expect(bullWinner(boardHit(20/170,0),boardHit(25/170,0))).toBe(0);
    let g=createGame([a,b]);g=gameAction(g,a,{type:'bull',hit:h(25,1)});g=gameAction(g,b,{type:'bull',hit:h(25,1)});g=gameAction(g,a,{type:'next'});g=gameAction(g,b,{type:'next'});
    expect(g.bullRound).toBe(2);expect(g.bull).toEqual([null,null]);expect(g.phase).toBe('bull');
  });
});
describe('Aufnahmen und Korrekturen',()=>{
  it('Überwerfen setzt die gesamte Aufnahme zurück; 1 und falsches Finish sind bei Double Out Bust',()=>{
    expect(visit(60,[h(20,1),h(20,3)],'double')).toMatchObject({remaining:60,credited:0,bust:true});
    expect(visit(2,[h(1,1)],'double').bust).toBe(true);
    expect(visit(20,[h(20,1)],'double').bust).toBe(true);
    expect(visit(20,[h(20,1)],'single').checkout).toBe(true);
    expect(visit(50,[h(25,2)],'double').checkout).toBe(true);
  });
  it('nur der aktive Spieler kann schreiben; Zuschauer und Gegner werden abgelehnt',()=>{
    const g=playing();expect(()=>gameAction(g,b,{type:'dart',hit:h(20,3)})).toThrow();
    expect(()=>gameAction(g,'viewer',{type:'undo'})).toThrow();
  });
  it('nach Weiter kann der vorherige Spieler nicht zurück; der neue Spieler kann eine leere Aufnahme zurückgeben',()=>{
    let g=playing();g=gameAction(g,a,{type:'dart',hit:h(20,3)});g=gameAction(g,a,{type:'next'});
    expect(()=>gameAction(g,a,{type:'undo'})).toThrow();
    g=gameAction(g,b,{type:'dart',hit:h(19,1)});g=gameAction(g,b,{type:'undo'});
    expect(gameView(g).active).toBe(1);g=gameAction(g,b,{type:'undo'});
    expect(gameView(g).active).toBe(0);expect(g.current).toHaveLength(1);
    g=gameAction(g,a,{type:'undo'});expect(g.current).toHaveLength(0);expect(gameView(g).remaining[0]).toBe(301);
  });
  it('Ausgewählter Dart lässt sich ersetzen; Marker, Summe und Restpunkte ändern sich gemeinsam',()=>{
    let g=playing();for(const dart of [h(20,3),h(19,3),h(18,3)])g=gameAction(g,a,{type:'dart',hit:dart});
    expect(gameView(g).remaining[0]).toBe(130);
    g=gameAction(g,a,{type:'dart',index:1,hit:h(1,1)});
    expect(g.current.map(points)).toEqual([60,1,54]);expect(gameView(g).remaining[0]).toBe(186);
  });
  it('Leg-Sieg wird erst mit Weiter bestätigt; Leg-Beginn wechselt und darf vor dem nächsten Dart korrigiert werden',()=>{
    let g=playing(301,2);
    for(const dart of [h(20,3),h(20,3),h(20,3)])g=gameAction(g,a,{type:'dart',hit:dart});
    g=gameAction(g,a,{type:'next'});g=gameAction(g,b,{type:'dart',hit:h(0,1)});g=gameAction(g,b,{type:'next'});
    for(const dart of [h(20,3),h(11,3),h(14,2)])g=gameAction(g,a,{type:'dart',hit:dart});
    expect(gameView(g).current.checkout).toBe(true);expect(gameView(g).legs).toEqual([0,0]);
    g=gameAction(g,a,{type:'next'});expect(gameView(g).legs).toEqual([1,0]);expect(gameView(g).active).toBe(1);
    expect(gameView(g).legDarts).toEqual([0,0]);expect(gameView(g).legAverage).toEqual([0,0]);expect(gameView(g).legTurns).toEqual([]);expect(gameView(g).darts).toEqual([6,1]);expect(gameView(g).average[0]).toBeCloseTo(150.5);
    const next=gameAction(g,b,{type:'dart',hit:h(20,1)});expect(gameView(next).legDarts).toEqual([0,1]);expect(gameView(next).legAverage).toEqual([0,60]);expect(gameView(next).average[1]).toBe(30);
    g=gameAction(g,b,{type:'undo'});expect(gameView(g).legs).toEqual([0,0]);expect(gameView(g).active).toBe(0);expect(gameView(g).legDarts).toEqual([6,1]);expect(gameView(g).legAverage[0]).toBeCloseTo(150.5);expect(gameView(g).legTurns).toHaveLength(2);
  });
  it('Ziellimit beendet das Match atomar; Stats zählen tatsächliche Darts und gültige Punkte',()=>{
    let g=playing(301,1);
    for(const dart of [h(20,3),h(20,3),h(20,3)])g=gameAction(g,a,{type:'dart',hit:dart});
    g=gameAction(g,a,{type:'next'});g=gameAction(g,b,{type:'dart',hit:h(0,1)});g=gameAction(g,b,{type:'next'});
    for(const dart of [h(20,3),h(11,3),h(14,2)])g=gameAction(g,a,{type:'dart',hit:dart});
    g=gameAction(g,a,{type:'next'});expect(g.phase).toBe('finished');expect(gameView(g).legs).toEqual([1,0]);
    expect(gameView(g).darts).toEqual([6,1]);expect(gameView(g).average[0]).toBeCloseTo(150.5);
    expect(()=>gameAction(g,a,{type:'undo'})).toThrow();
  });
  it('Checkout-Vorschläge sind nur im Finish-Bereich und enden korrekt',()=>{
    expect(checkout(300,'double')).toEqual([]);expect(checkout(169,'double')).toEqual([]);
    expect(checkout(170,'double')).toEqual(['T20','T20','Bull']);expect(checkout(40,'double')).toEqual(['D20']);expect(checkout(20,'double',1)).toEqual(['D10']);expect(checkout(20,'single',1)).toEqual(['S20']);
    expect(checkout(60,'double',1)).toEqual([]);expect(checkout(60,'single',1)).toEqual(['T20']);
    for(let n=2;n<=170;n++){const route=checkout(n,'double');if(!route.length)continue;expect(route.length).toBeLessThanOrEqual(3);expect(route.at(-1)?.startsWith('D')||route.at(-1)==='Bull').toBe(true);}
  });
});

describe('Bestätigtes Ausbullen und Stellen',()=>{
  it('startet erst nach zwei Bestätigungen; Ändern oder Zurück nimmt die eigene Bestätigung zurück',()=>{
    let g=createGame([a,b]);expect(()=>gameAction(g,a,{type:'next'})).toThrow();
    g=gameAction(g,a,{type:'bull',hit:h(25,2)});g=gameAction(g,b,{type:'bull',hit:h(25,1)});
    expect(g.phase).toBe('bull');g=gameAction(g,a,{type:'next'});expect(g.bullConfirmed).toEqual([true,false]);
    g=gameAction(g,a,{type:'bull',hit:h(25,2)});expect(g.bullConfirmed).toEqual([false,false]);
    g=gameAction(g,a,{type:'next'});g=gameAction(g,a,{type:'undo'});expect(g.bull[0]).toBeNull();expect(g.bullConfirmed).toEqual([false,false]);
    g=gameAction(g,a,{type:'bull',hit:h(25,2)});g=gameAction(g,a,{type:'next'});g=gameAction(g,b,{type:'next'});
    expect(g.phase).toBe('playing');expect(g.starter).toBe(0);
  });
  it('bestehende Ausbullen-Zustände ohne Bestätigungsfeld bleiben verwendbar',()=>{
    let g=createGame([a,b]);delete g.bullConfirmed;g=gameAction(g,a,{type:'bull',hit:h(25,2)});expect(g.bullConfirmed).toEqual([false,false]);
  });
  it('unter 180 sind Checkout oder sichere Stell-Vorschläge passend zur Out-Regel verfügbar',()=>{
    expect(recommendation(180,'double')).toBeNull();expect(recommendation(301,'single')).toBeNull();
    expect(recommendation(20,'double',1)).toMatchObject({kind:'checkout',route:['D10']});expect(recommendation(20,'single',1)).toMatchObject({route:['S20']});
    expect(recommendation(179,'double')).toMatchObject({kind:'setup',leave:32});
    const hits=[...sectors.flatMap(n=>[h(n,1),h(n,2),h(n,3)]),h(25,1),h(25,2)];
    for(const out of ['double','single'] as const)for(let rest=out==='double'?2:1;rest<180;rest++)for(let left=1;left<=3;left++){
      const advice=recommendation(rest,out,left);expect(advice).not.toBeNull();
      const darts=advice!.route.map(label=>hits.find(d=>hitLabel(d)===label)!);expect(darts.length).toBeLessThanOrEqual(left);
      const v=visit(rest,darts,out);expect(v.bust).toBe(false);expect(v.remaining).toBe(advice!.leave);
      if(advice!.kind==='checkout')expect(v.checkout).toBe(true);else {expect(v.checkout).toBe(false);expect(checkout(v.remaining,out).length).toBeGreaterThan(0);}
    }
  });
});
