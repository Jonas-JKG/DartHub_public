import { describe,it,expect } from 'vitest';
import { existsSync } from 'node:fs';
import { CallerTracker,callClips } from '../src/domain/caller';
import { walkOnSongs } from '../src/domain/audio-assets';
import { createGame,gameAction,gameView,keypadHit,type Game } from '../src/domain/scoring';
function playing(out:'single'|'double'='double',start:301|501=501){let g=createGame(['a','b'],{start,out,legsToWin:2});g=gameAction(g,'a',{type:'bull',hit:keypadHit(25,2)});g=gameAction(g,'b',{type:'bull',hit:keypadHit(25,1)});g=gameAction(g,'a',{type:'next'});return gameAction(g,'b',{type:'next'});}
const add=(g:Game,n:number,m:1|2|3=1)=>gameAction(g,g.players[gameView(g).active],{type:'dart',hit:keypadHit(n,m)});
const miss={player:1 as const,darts:[keypadHit(0,1)]};
const first={player:0 as const,darts:[keypadHit(20,3),keypadHit(20,3),keypadHit(20,3)]};
describe('Caller',()=>{
  it('sagt die Aufnahme erst nach drei Darts, unabhängig von Polling und Weiter',()=>{
    const c=new CallerTracker();let g=playing();c.update(g);for(let i=0;i<2;i++){g=add(g,20,3);expect(c.update(g)).toEqual([]);}g=add(g,20,3);expect(c.update(g)).toMatchObject([{type:'score',value:180}]);expect(c.update(g)).toEqual([]);g=gameAction(g,'a',{type:'next'});expect(c.update(g)).toEqual([]);
  });
  it('erkennt frühe Checkouts und Überwerfen sowie bestätigte kurze Aufnahmen',()=>{
    const c=new CallerTracker();let g=playing('double',301);c.update(g);g=add(g,20,1);expect(c.update(g)).toEqual([]);g=gameAction(g,'a',{type:'next'});expect(c.update(g)).toMatchObject([{type:'score',value:20}]);
    g={...playing('double',301),turns:[first,miss,{player:0,darts:[keypadHit(20,3),keypadHit(20,2)]},miss]};expect(gameView(g).remaining[0]).toBe(21);const bust=new CallerTracker();bust.update(g);g=add(g,20);expect(bust.update(g)).toMatchObject([{type:'score',value:0}]);
    g={...playing('double',301),turns:[first,miss,{player:0,darts:[keypadHit(20,3),keypadHit(20,2),keypadHit(19,1)]},miss]};expect(gameView(g).remaining[0]).toBe(2);const finish=new CallerTracker();finish.update(g);g=add(g,1,2);expect(finish.update(g)).toMatchObject([{type:'score',value:2}]);
  });
  it('sagt You require 170 zum Zugbeginn, nicht nach einzelnen Darts',()=>{
    let g:Game={...playing(),turns:[first,miss,{player:0 as const,darts:[keypadHit(20,3),keypadHit(17,3),keypadHit(20,2)]},miss]};expect(gameView(g).remaining[0]).toBe(170);
    const c=new CallerTracker();expect(c.update(g)).toMatchObject([{type:'require',value:170}]);expect(c.update(g)).toEqual([]);g=add(g,20,3);expect(c.update(g)).toEqual([]);
  });
  it('berücksichtigt Single Out und Double Out sowie nicht ausmachbare Restwerte',()=>{
    const g={...playing(),turns:[first,miss,{player:0 as const,darts:[keypadHit(20,3),keypadHit(20,3),keypadHit(18,2)]},miss]};expect(gameView(g).remaining[0]).toBe(165);expect(new CallerTracker().update(g)).toEqual([]);expect(new CallerTracker().update({...g,rules:{...g.rules,out:'single'}})).toMatchObject([{type:'require',value:165}]);
  });
  it('Game on kommt nach Ausbullen, alte Aufnahmen werden beim Öffnen nicht nachgesprochen',()=>{
    const c=new CallerTracker();c.update(createGame(['a','b']));const g=playing();expect(c.update(g)).toMatchObject([{type:'gameon'}]);let old=g;for(let i=0;i<3;i++)old=add(old,20,3);old=gameAction(old,'a',{type:'next'});expect(new CallerTracker().update(old)).toEqual([]);
  });
  it('spricht korrigierte Summen neu und beim Bestätigen nicht doppelt',()=>{
    const c=new CallerTracker();let g=playing();c.update(g);for(let i=0;i<3;i++)g=add(g,20,3);expect(c.update(g)[0].value).toBe(180);
    g=gameAction(g,'a',{type:'dart',index:0,hit:keypadHit(20,1)});expect(c.update(g)[0].value).toBe(140);g=gameAction(g,'a',{type:'dart',index:0,hit:keypadHit(20,3)});expect(c.update(g)[0].value).toBe(180);expect(c.update(g)).toEqual([]);g=gameAction(g,'a',{type:'next'});expect(c.update(g)).toEqual([]);
  });
  it('requests no caller without a pack and supports the original file layout when enabled',()=>{
    expect(callClips({key:'score',type:'score',value:180},false)).toEqual([]);
    expect(callClips({key:'require',type:'require',value:170},true).map(c=>c.src)).toEqual(['/audio/caller/You_require.m4a','/audio/caller/170.wav']);
    expect(callClips({key:'gameon',type:'gameon'},true)[0].src).toBe('/audio/caller/gameon.wav');
    for(const song of walkOnSongs)expect(existsSync('public/audio/walk-on/'+song)).toBe(true);
  });
});
