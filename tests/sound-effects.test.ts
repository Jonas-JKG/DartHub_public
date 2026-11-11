import {describe,it,expect,vi} from 'vitest';
import {SoundEffectsAudio} from '../src/client/sound-effects';
import {SoundEffectTracker,hitEffect,effectFiles} from '../src/domain/sound-effects';
import {createGame,gameAction,gameView,keypadHit,type Game} from '../src/domain/scoring';
import {existsSync} from 'node:fs';
function playing(legsToWin=2){let g=createGame(['a','b'],{start:301,out:'double',legsToWin});g=gameAction(g,'a',{type:'bull',hit:keypadHit(25,2)});g=gameAction(g,'b',{type:'bull',hit:keypadHit(25,1)});g=gameAction(g,'a',{type:'next'});return gameAction(g,'b',{type:'next'});}
const hit=(g:Game,n:number,m:1|2|3=3)=>gameAction(g,g.players[gameView(g).active],{type:'dart',hit:keypadHit(n,m)});
describe('Treffer- und Siegessounds',()=>{
 it('trennt drei Triple-Bereiche, Bull, 25 und Doppel',()=>{for(let n=1;n<=20;n++)expect(hitEffect(keypadHit(n,3))).toBe(n<10?'triple-low':n<17?'triple-mid':'triple-high');expect(hitEffect(keypadHit(25,2))).toBe('bull');expect(hitEffect(keypadHit(25,1))).toBe('single-bull');expect(hitEffect(keypadHit(16,2))).toBe('double');expect(hitEffect(keypadHit(20,1))).toBeNull();expect(hitEffect(keypadHit(0,1))).toBeNull();for(const file of Object.values(effectFiles))expect(existsSync('public/audio/effects/'+file)).toBe(true);});
 it('spielt jeden Dart einmal, Korrekturen neu und Weiter nicht doppelt',()=>{const tracker=new SoundEffectTracker();let g=playing();expect(tracker.update(g)).toEqual([]);g=hit(g,20);expect(tracker.update(g)).toEqual(['triple-high']);expect(tracker.update(g)).toEqual([]);g=hit(g,12);expect(tracker.update(g)).toEqual(['triple-mid']);g=hit(g,4);expect(tracker.update(g)).toEqual(['triple-low']);g=gameAction(g,'a',{type:'dart',index:0,hit:keypadHit(25,2)});expect(tracker.update(g)).toEqual(['bull']);g=gameAction(g,'a',{type:'next'});expect(tracker.update(g)).toEqual([]);g=gameAction(g,'b',{type:'undo'});expect(tracker.update(g)).toEqual([]);g=gameAction(g,'a',{type:'undo'});expect(tracker.update(g)).toEqual([]);g=hit(g,16,2);expect(tracker.update(g)).toEqual(['double']);});
 it('ignoriert alte Würfe beim Beitritt und Positionskorrekturen desselben Felds',()=>{let g=hit(playing(),20);const tracker=new SoundEffectTracker();expect(tracker.update(g)).toEqual([]);g=gameAction(g,'a',{type:'dart',index:0,hit:{...g.current[0],position:{x:.01,y:-.6}}});expect(tracker.update(g)).toEqual([]);});
 it('erkennt gegnerische Würfe auch wenn die Bestätigung vor dem Poll eintrifft',()=>{let g=playing();const tracker=new SoundEffectTracker();tracker.update(g);g=hit(g,20);g=gameAction(g,'a',{type:'next'});expect(tracker.update(g)).toEqual(['triple-high']);g=hit(g,25,1);expect(tracker.update(g)).toEqual(['single-bull']);g=gameAction(g,'b',{type:'next'});expect(tracker.update(g)).toEqual([]);});
 it('Leg- und Matchsieg kommen beim Checkout, nicht erneut beim Weiter',()=>{for(const legs of [1,2]){let g=playing(legs);g.turns=[{player:0,darts:[keypadHit(20,3),keypadHit(20,3),keypadHit(20,3)]},{player:1,darts:[keypadHit(0,1)]},{player:0,darts:[keypadHit(20,3),keypadHit(20,1),keypadHit(1,1)]},{player:1,darts:[keypadHit(0,1)]}];const tracker=new SoundEffectTracker();tracker.update(g);g=hit(g,20,2);expect(tracker.update(g)).toEqual(['double',legs===1?'match-win':'leg-win']);expect(tracker.update(g)).toEqual([]);g=gameAction(g,'a',{type:'next'});expect(tracker.update(g)).toEqual([]);}});
});

class TestAudio {
 static all:TestAudio[]=[];paused=true;src='';volume=1;preload='';dataset:Record<string,string>={};
 constructor(src=''){this.src=src;TestAudio.all.push(this);}
 play(){this.paused=false;return Promise.resolve();}pause(){this.paused=true;}load(){}removeAttribute(){this.src='';}
}
it('Audiofreigabe unterbricht keinen laufenden Sieg und der Ausschnitt endet nach 25 Sekunden',()=>{
 vi.useFakeTimers();vi.stubGlobal('Audio',TestAudio);TestAudio.all=[];const audio=new SoundEffectsAudio(()=>{});
 try{audio.play('match-win');const winner=TestAudio.all.find(a=>a.dataset.audioChannel==='victory')!;audio.unlock();expect(winner.src).toBe('/audio/effects/match-win.mp3');expect(winner.paused).toBe(false);vi.advanceTimersByTime(24999);expect(winner.paused).toBe(false);vi.advanceTimersByTime(1);expect(winner.paused).toBe(true);}finally{audio.dispose();vi.unstubAllGlobals();vi.useRealTimers();}
});
it('Effekte werden separat geregelt und beim Verlassen beendet',()=>{
 vi.useFakeTimers();vi.stubGlobal('Audio',TestAudio);TestAudio.all=[];const audio=new SoundEffectsAudio(()=>{});
 try{audio.volume(.35);audio.play('triple-high');audio.play('match-win');for(const a of TestAudio.all.filter(a=>a.dataset.audioChannel))expect(a.volume).toBe(.35);audio.stop();expect(TestAudio.all.every(a=>a.paused)).toBe(true);expect(vi.getTimerCount()).toBe(0);}finally{audio.dispose();vi.unstubAllGlobals();vi.useRealTimers();}
});

it('Leg-Sieg verwendet einen eigenen kurzen Sound ohne Wiederholung',()=>{vi.useFakeTimers();vi.stubGlobal('Audio',TestAudio);TestAudio.all=[];const audio=new SoundEffectsAudio(()=>{});try{audio.play('leg-win');const winner=TestAudio.all.find(a=>a.dataset.audioChannel==='victory')!;expect(winner.src).toBe('/audio/effects/leg-win.wav');expect((winner as unknown as {loop:boolean}).loop).toBe(false);vi.advanceTimersByTime(3199);expect(winner.paused).toBe(false);vi.advanceTimersByTime(1);expect(winner.paused).toBe(true);expect((winner as unknown as {loop:boolean}).loop).toBe(false);}finally{audio.dispose();vi.unstubAllGlobals();vi.useRealTimers();}});
