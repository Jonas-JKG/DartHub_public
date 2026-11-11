import {it,expect} from 'vitest';
import {createTrainingGame,gameAction,gameView,practiceView,keypadHit,defaultRules,type Game} from '../src/domain/scoring';
import {CallerTracker} from '../src/domain/caller';
import {SoundEffectTracker} from '../src/domain/sound-effects';
const add=(g:Game,n:number,m:1|2|3=1)=>gameAction(g,'a',{type:'dart',hit:keypadHit(n,m)});
it('segment practice rotates selected segments after a turn, counts hits instead of points and ends after 30 darts',()=>{
 let g=createTrainingGame(['a','b'],defaultRules,true,'segments','a',{segments:[20,19,18]});
 for(let dart=0;dart<30;dart++){
  const target=practiceView(g).target!;g=add(g,dart%3===0?0:target,dart%3===0?1:3);
  if(dart%3===2)g=gameAction(g,'a',{type:'next'});
 }
 expect(g.phase).toBe('finished');expect(practiceView(g)).toMatchObject({completed:20,total:30,darts:30,complete:true});expect(gameView(g).current.checkout).toBe(false);
});
it('segment corrections and undo recompute hits and target without changing saved configuration',()=>{
 let g=createTrainingGame(['a','b'],defaultRules,true,'segments','a',{segments:[20,19]});g=add(g,20,3);g=gameAction(g,'a',{type:'dart',index:0,hit:keypadHit(1,1)});expect(practiceView(g).completed).toBe(0);g=gameAction(g,'a',{type:'next'});expect(practiceView(g).target).toBe(19);g=gameAction(g,'a',{type:'undo'});expect(practiceView(g)).toMatchObject({target:20,darts:1});
});
it.each(['single','double'] as const)('random checkout runs ten persisted tasks with %s out, including busts and early confirmation',out=>{
 let g=createTrainingGame(['a','b'],{...defaultRules,out,legsToWin:1},true,'checkout','a',{segments:[20]},Array(10).fill(40));
 for(let i=0;i<10;i++){
  g=add(g,20,i%2?1:2);
  if(i%2){g=add(g,20);if(out==='double')expect(practiceView(g).bust).toBe(true);}
  expect(practiceView(g).turnComplete).toBe(true);expect(()=>add(g,1)).toThrow();g=gameAction(g,'a',{type:'next'});
 }
 expect(g.phase).toBe('finished');expect(practiceView(g)).toMatchObject({completed:out==='double'?5:10,total:10});expect(g.checkoutTargets).toEqual(Array(10).fill(40));
});
it('final checkout task may be confirmed early, and a correction can cancel a checkout',()=>{
 let g=createTrainingGame(['a','b'],defaultRules,true,'checkout','a',{segments:[20]},Array(10).fill(40));
 g=add(g,20,2);g=gameAction(g,'a',{type:'dart',index:0,hit:keypadHit(1,1)});expect(practiceView(g).turnComplete).toBe(false);g=gameAction(g,'a',{type:'next'});
 for(let i=1;i<10;i++){g=add(g,0);g=gameAction(g,'a',{type:'next'});}expect(g.phase).toBe('finished');
});
it('target callers announce required Clock numbers after each hit and turn; misses, polling and confirmation never produce X01 scores',()=>{
 let g=createTrainingGame(['a','b'],defaultRules,true,'around-clock');const c=new CallerTracker(),fx=new SoundEffectTracker();
 expect(c.update(g)).toMatchObject([{type:'require',value:1}]);fx.update(g);
 g=add(g,1,3);expect(c.update(g)).toMatchObject([{type:'require',value:2}]);expect(fx.update(g)).toEqual([]);expect(c.update(g)).toEqual([]);
 g=add(g,0);expect(c.update(g)).toEqual([]);g=gameAction(g,'a',{type:'next'});expect(c.update(g)).toMatchObject([{type:'require',value:2}]);expect(fx.update(g)).toEqual([]);
});
it('invalid practice configurations and extra players are rejected',()=>{
 expect(()=>createTrainingGame(['a','b'],defaultRules,false,'segments')).toThrow();expect(()=>createTrainingGame(['a','b'],defaultRules,true,'segments','a',{segments:[]})).toThrow();expect(()=>createTrainingGame(['a','b'],defaultRules,true,'checkout','a',{segments:[20]},Array(10).fill(169))).toThrow();
});
