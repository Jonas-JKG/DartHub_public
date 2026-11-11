import {it,expect,vi,afterEach} from 'vitest';
import {DeckEffectTracker,DeckEffectsAudio} from '../src/client/dartdeck-effects';
import {createDeckGame,deckAction,shuffledDeck} from '../src/domain/dartdeck';
import {keypadHit} from '../src/domain/scoring';
function game(first='sector-20-1'){const deck=shuffledDeck('mixed',()=>0);deck.splice(deck.indexOf(first),1);deck.unshift(first);return createDeckGame([{id:'a',name:'Alice',controllerId:'a',accountId:'a'},{id:'b',name:'Bob',controllerId:'b',accountId:'b'}],{rounds:1,difficulty:'mixed'},deck);}
it('joining, polling and corrections do not replay effects; success is heard once',()=>{
 const t=new DeckEffectTracker();let g=game();expect(t.update(g)).toEqual([]);g=deckAction(g,'a',{type:'dart',hit:keypadHit(1,1)});expect(t.update(g)).toEqual(['hit']);expect(t.update(g)).toEqual([]);
 g=deckAction(g,'a',{type:'dart',hit:keypadHit(2,1),index:0});expect(t.update(g)).toEqual([]);
 g=deckAction(g,'a',{type:'dart',hit:keypadHit(20,1),index:0});expect(t.update(g)).toEqual(['success']);g=deckAction(g,'a',{type:'undo'});t.update(g);g=deckAction(g,'a',{type:'dart',hit:keypadHit(20,1)});expect(t.update(g)).toEqual(['target']);
 g=deckAction(g,'a',{type:'next'});expect(t.update(g)).toEqual(['turn']);expect(t.update(game())).toEqual([]);
});
it('shared skip, remote completed turns, misses and finish have distinct effects',()=>{
 const t=new DeckEffectTracker();let g=game();t.update(g);g=deckAction(g,'a',{type:'vote-skip',agree:true,cardDraw:0,gameId:g.id});expect(t.update(g)).toEqual([]);g=deckAction(g,'b',{type:'vote-skip',agree:true,cardDraw:0,gameId:g.id});expect(t.update(g)).toEqual(['skip']);
 g=deckAction(g,'a',{type:'dart',hit:keypadHit(0,1)});expect(t.update(g)).toEqual(['miss']);g=deckAction(g,'a',{type:'next'});expect(t.update(g)).toEqual(['turn']);g=deckAction(g,'b',{type:'dart',hit:keypadHit(0,1)});g=deckAction(g,'b',{type:'next'});expect(t.update(g)).toEqual(['finish']);expect(t.update(g)).toEqual([]);
 const remote=new DeckEffectTracker();let other=game();remote.update(other);other=deckAction(other,'a',{type:'dart',hit:keypadHit(20,1)});other=deckAction(other,'a',{type:'next'});expect(remote.update(other)).toEqual(['success']);
});
afterEach(()=>vi.unstubAllGlobals());
it('blocked Safari audio waits for a gesture; muting cancels pending sounds',async()=>{
 let running=false;const frequencies:number[]=[];
 class Context{currentTime=0;destination={};state='suspended';resume(){if(!running)return Promise.reject(new Error('Gesture required'));this.state='running';return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}createOscillator(){return {type:'',frequency:{setValueAtTime:(n:number)=>frequencies.push(n),exponentialRampToValueAtTime:()=>{}},connect:()=>{},disconnect:()=>{},start:()=>{},stop:()=>{},onended:null};}createGain(){return {gain:{setValueAtTime:()=>{},linearRampToValueAtTime:()=>{},exponentialRampToValueAtTime:()=>{}},connect:()=>{},disconnect:()=>{}};}}
 vi.stubGlobal('window',{webkitAudioContext:Context});const audio=new DeckEffectsAudio();audio.play('success');audio.unlock();await Promise.resolve();expect(frequencies).toEqual([]);running=true;audio.unlock();await Promise.resolve();expect(frequencies).toEqual([660,880]);audio.unlock();await Promise.resolve();expect(frequencies).toHaveLength(2);audio.dispose();
 const muted=new DeckEffectsAudio();muted.play('finish');muted.stop();muted.unlock();await Promise.resolve();expect(frequencies).toHaveLength(2);muted.dispose();
});

it('a useful target gets a positive sound while a repeated set segment does not advance the task',()=>{
 const tracker=new DeckEffectTracker();let g=game('pair-20');tracker.update(g);g=deckAction(g,'a',{type:'dart',hit:keypadHit(20,1)});expect(tracker.update(g)).toEqual(['target']);g=deckAction(g,'a',{type:'dart',hit:keypadHit(20,1)});expect(tracker.update(g)).toEqual(['hit']);g=deckAction(g,'a',{type:'dart',hit:keypadHit(19,1)});expect(tracker.update(g)).toEqual(['success']);
});
