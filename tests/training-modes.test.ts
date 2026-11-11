import {it,expect} from 'vitest';
import {createTrainingGame,gameAction,gameView,aroundClockView,keypadHit} from '../src/domain/scoring';
const players:[string,string]=['a','b'];
it('solo X01 skips bull, retains the same player after every visit and checkout, and respects busts',()=>{
 let g=createTrainingGame(players,{start:301,out:'double',legsToWin:2},true);
 expect(g).toMatchObject({solo:true,phase:'playing',starter:0});
 expect(()=>gameAction(g,'b',{type:'dart',hit:keypadHit(20,3)})).toThrow();
 const dart=(n:number,m:1|2|3=1)=>{g=gameAction(g,'a',{type:'dart',hit:keypadHit(n,m)});};
 for(let i=0;i<3;i++)dart(20,3);g=gameAction(g,'a',{type:'next'});
 expect(gameView(g)).toMatchObject({active:0,remaining:[121,301]});
 dart(20,3);dart(20,3);expect(gameView(g).current.bust).toBe(true);g=gameAction(g,'a',{type:'next'});
 expect(gameView(g).remaining[0]).toBe(121);
 dart(20,3);dart(11);dart(25,2);g=gameAction(g,'a',{type:'next'});
 expect(gameView(g)).toMatchObject({active:0,legs:[1,0],remaining:[301,301]});
});
it('solo X01 completes legs and keeps the starter on the only active side',()=>{
 let g=createTrainingGame(players,{start:301,out:'single',legsToWin:2},true);
 for(let leg=0;leg<2;leg++){
  for(const visit of [[60,60,60],[60,60,1]]){
   for(const score of visit)g=gameAction(g,'a',{type:'dart',hit:score===60?keypadHit(20,3):keypadHit(1,1)});
   g=gameAction(g,'a',{type:'next'});
  }
  expect(gameView(g).legs).toEqual([leg+1,0]);expect(gameView(g).active).toBe(0);
 }
 expect(g.phase).toBe('finished');
});
it('Around the Clock advances once per correct target, accepts both bulls and counts misses',()=>{
 for(const bull of [1,2] as const){
  let g=createTrainingGame(players,{start:501,out:'double',legsToWin:2},true,'around-clock');
  g=gameAction(g,'a',{type:'dart',hit:keypadHit(0,1)});
  g=gameAction(g,'a',{type:'dart',hit:keypadHit(2,3)});expect(aroundClockView(g)).toMatchObject({target:1,completed:0,darts:2});
  g=gameAction(g,'a',{type:'dart',hit:keypadHit(1,3)});g=gameAction(g,'a',{type:'next'});
  for(let n=2;n<=20;n++){
   g=gameAction(g,'a',{type:'dart',hit:keypadHit(n,n%2?2:1)});
   if(g.current.length===3)g=gameAction(g,'a',{type:'next'});
  }
  g=gameAction(g,'a',{type:'dart',hit:keypadHit(25,bull)});
  expect(aroundClockView(g)).toMatchObject({complete:true,darts:23,completed:21});
  expect(()=>gameAction(g,'a',{type:'dart',hit:keypadHit(0,1)})).toThrow();
  g=gameAction(g,'a',{type:'next'});expect(g.phase).toBe('finished');expect(gameView(g).legs).toEqual([1,0]);
 }
});
it('Around the Clock supports undo and corrections without retaining later target progress',()=>{
 let g=createTrainingGame(players,{start:501,out:'single',legsToWin:1},true,'around-clock');
 for(let n=1;n<=3;n++)g=gameAction(g,'a',{type:'dart',hit:keypadHit(n,1)});
 g=gameAction(g,'a',{type:'next'});expect(aroundClockView(g).target).toBe(4);
 g=gameAction(g,'a',{type:'undo'});expect(g.turns).toHaveLength(0);
 g=gameAction(g,'a',{type:'dart',hit:keypadHit(0,1),index:0});expect(aroundClockView(g)).toMatchObject({target:1,completed:0,darts:3});
 expect(createTrainingGame(players,g.rules,false,'around-clock')).toMatchObject({solo:false,phase:'playing'});
});
it('normal X01 retains bull-off and two-player turns',()=>{
 const g=createTrainingGame(players,{start:501,out:'double',legsToWin:1},false);
 expect(g.phase).toBe('bull');expect(g.solo).toBeUndefined();
});

it.each(['x01','around-clock'] as const)('solo %s uses the host on the second side in an older shuffled room',mode=>{
 let g=createTrainingGame(players,{start:301,out:'single',legsToWin:1},true,mode,'b');
 expect(g.starter).toBe(1);expect(gameView(g).active).toBe(1);expect(()=>gameAction(g,'a',{type:'dart',hit:keypadHit(1,1)})).toThrow();
 g=gameAction(g,'b',{type:'dart',hit:keypadHit(1,1)});g=gameAction(g,'b',{type:'next'});
 expect(gameView(g).active).toBe(1);expect(gameView(g).darts).toEqual([0,1]);
 if(mode==='around-clock')expect(aroundClockView(g).target).toBe(2);else expect(gameView(g).remaining).toEqual([301,300]);
});

it('six Around-the-Clock players retain separate progress and rotate only after confirming',()=>{
 const ids=['a','b','c','d','e','f'];let g=createTrainingGame(ids,{start:501,out:'single',legsToWin:1},false,'around-clock');
 for(let i=0;i<6;i++){
  expect(gameView(g).active).toBe(i);expect(()=>gameAction(g,ids[(i+1)%6],{type:'dart',hit:keypadHit(1,1)})).toThrow('Reihe');
  g=gameAction(g,ids[i],{type:'dart',hit:keypadHit(1,1)});expect(gameView(g).active).toBe(i);expect(aroundClockView(g,i).target).toBe(2);
  g=gameAction(g,ids[i],{type:'next'});
 }
 expect(gameView(g).active).toBe(0);for(let i=0;i<6;i++)expect(aroundClockView(g,i)).toMatchObject({target:2,darts:1});
 expect(()=>createTrainingGame([...ids,'g'],g.rules,false,'around-clock')).toThrow();expect(()=>createTrainingGame(['a','a'],g.rules,false,'around-clock')).toThrow();
});
it('the third player can win; miss/correction and undo never alter another player',()=>{
 let g=createTrainingGame(['a','b','c'],{start:501,out:'single',legsToWin:1},false,'around-clock');
 while(g.phase!=='finished'){
  const actor=g.players[gameView(g).active];
  if(actor!=='c'){g=gameAction(g,actor,{type:'dart',hit:keypadHit(0,1)});g=gameAction(g,actor,{type:'next'});continue;}
  const target=aroundClockView(g).target!;g=gameAction(g,actor,{type:'dart',hit:keypadHit(target,1)});
  g=gameAction(g,actor,{type:'dart',hit:keypadHit(0,1),index:0});expect(aroundClockView(g).target).toBe(target);
  g=gameAction(g,actor,{type:'dart',hit:keypadHit(target,1),index:0});g=gameAction(g,actor,{type:'next'});
 }
 expect(gameView(g).active).toBe(2);expect(aroundClockView(g,2)).toMatchObject({complete:true,darts:21});expect(aroundClockView(g,0).completed).toBe(0);expect(gameView(g).legs).toEqual([0,0,1]);expect(gameView(g).current.checkout).toBe(false);expect(gameView(g).lastLegWin?.player).toBe(2);
});
