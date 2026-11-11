import {test,expect,type Page,type WebSocketRoute} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {createTournament} from '../../src/domain/tournament';
import {createTrainingGame,gameAction,gameView,type Game} from '../../src/domain/scoring';

async function setup(page:Page){
 const account=randomUUID(),t={...createTournament({id:randomUUID(),kind:'training',name:'Practice',names:['anna','Mitspieler'],mode:'knockout',groupSize:2,advancePerGroup:1,scoring:{start:301,out:'single',legsToWin:1}},()=>0,randomUUID),managerId:account,trainingMode:'x01' as 'x01'|'around-clock'};
 let created=false,local=false,phase='waiting',game:Game|null=null;const requests:any[]=[];
 await page.addInitScript(()=>{localStorage.setItem('match-fullscreen','off');localStorage.setItem('match-input-mode','keyboard');});
 await page.route('**/api/identity',r=>r.fulfill({json:{signedIn:true,role:'owner'}}));
 await page.route('**/api/friends**',r=>r.fulfill({json:{account:true,friends:[],invitations:[]}}));
 await page.route('**/api/players**',r=>r.fulfill({json:{players:[]}}));
 await page.route('**/api/autodarts**',r=>r.fulfill({json:{canLink:true,authenticated:false}}));
 await page.route('**/api/training**',r=>{
  if(r.request().method()==='POST'){
   const p=r.request().postDataJSON();requests.push(p);
   if(p.operation==='create'){created=true;t.trainingMode=p.mode;t.scoring=p.mode==='around-clock'?{start:501,out:'single',legsToWin:1}:p.rules;return r.fulfill({json:{ok:true,redirect:'/training/'+t.id}});}
   if(p.operation==='local'){local=true;t.participants[1].name=p.name;}
   if(p.operation==='remove')local=false;
   if(p.operation==='start'){game=createTrainingGame(t.matches[0].players as [string,string],t.scoring!,!local,t.trainingMode,t.participants[0].id);if(local)game.sharedDevice=true;phase='playing';t.status='running';return r.fulfill({json:{ok:true,redirect:'/training/'+t.id+'/games/'+t.matches[0].id}});}
   return r.fulfill({json:{ok:true}});
  }
  return r.fulfill({json:{account:true,accountRole:'player',modesReady:true,playerName:'anna',accountId:account,host:true,canStart:true,participantIds:t.participants.filter((_,i)=>i===0||local).map(p=>p.id),rooms:[],...(created?{room:{id:t.id,phase,round:1,matchId:t.matches[0].id,tournament:t,game,lastResult:null,seats:t.participants.map((p,i)=>({position:i,participantId:p.id,accountId:i===0?account:null,local:i===1&&local,ready:i===0||local}))}}:{})}});
 });
 await page.route('**/api/game**',r=>{
  if(r.request().method()==='POST'){
   const p=r.request().postDataJSON();if(p.operation==='presence')return r.fulfill({json:{ok:true}});
   requests.push(p);if(p.operation==='action')game=gameAction(game!,p.actor,p.action);
   return r.fulfill({json:{ok:true,game}});
  }
  return r.fulfill({json:{tournament:t,match:t.matches[0],game,session:{role:'editor',tournamentId:t.id,participantId:t.participants[0].id,participantIds:t.participants.filter((_,i)=>i===0||local).map(p=>p.id)}}});
 });
 return {t,requests,get game(){return game;}};
}

test('empty X01 lobby starts solo, skips bull-off and keeps scoring the same side',async({page})=>{
 const state=await setup(page);await page.goto('/training');await expect(page.getByLabel('Spielmodus')).toHaveValue('x01');await page.getByLabel('Startpunkte',{exact:true}).selectOption('301');await page.getByRole('button',{name:'Lobby eröffnen'}).click();
 await expect(page.getByText('Ohne Mitspieler startest du allein.')).toBeVisible();await page.getByRole('button',{name:'Match starten',exact:true}).click();
 await expect(page.locator('.game-player')).toHaveCount(1);await expect(page.getByRole('heading',{name:'Wer beginnt?'})).toHaveCount(0);
 await page.getByRole('button',{name:'Triple',exact:true}).click();for(let n=0;n<3;n++)await page.locator('.number-pad').getByRole('button',{name:'20',exact:true}).click();
 await page.getByRole('button',{name:'Weiter →',exact:true}).click();await expect.poll(()=>gameView(state.game!).remaining[state.game!.starter!]).toBe(121);
 await expect(page.getByRole('heading',{name:'anna ist am Zug',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
 if(page.viewportSize()!.width<=760)expect((await page.locator('.game-player').boundingBox())!.width).toBeGreaterThan(page.viewportSize()!.width*.8);
 await page.screenshot({path:'test-results/solo-'+page.viewportSize()!.width+'.png',fullPage:true});
});

test('local player is added without an account and shared-device confirmation switches to the next player',async({page})=>{
 const state=await setup(page);await page.goto('/training');await page.getByRole('button',{name:'Lobby eröffnen'}).click();await page.getByRole('button',{name:'Spieler hinzufügen',exact:true}).click();
 await page.getByLabel('Lokaler Spieler',{exact:true}).fill('Bärbel');await page.getByRole('button',{name:'Lokal hinzufügen',exact:true}).click();await expect(page.getByText('Lokal',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Match starten',exact:true}).click();await expect(page.locator('.game-player')).toHaveCount(2);await expect(page.getByRole('dialog',{name:'Spieler für dieses Match'})).toHaveCount(0);
 const first=state.game!.players.find(p=>p===state.t.participants[0].id)!;
 await page.getByRole('button',{name:'Bull · 50',exact:true}).click();await page.locator('.game-player').filter({has:page.getByRole('heading',{name:'anna',exact:true})}).getByRole('button',{name:'Weiter →'}).click();
 await expect(page.getByRole('heading',{name:'Bärbel wirft zum Ausbullen',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'25',exact:true}).click();await page.locator('.game-player').filter({has:page.getByRole('heading',{name:'Bärbel',exact:true})}).getByRole('button',{name:'Weiter →'}).click();
 await expect(page.getByRole('heading',{name:'anna ist am Zug',exact:true})).toBeVisible();expect(state.game!.starter).toBe(state.game!.players.indexOf(first));
 expect(state.requests.find(p=>p.operation==='local')).toEqual({operation:'local',id:state.t.id,name:'Bärbel'});
});

test('Around the Clock has no opponents, advances target per hit, supports correction and shows practice stats',async({page})=>{
 await setup(page);await page.goto('/training');await page.getByLabel('Spielmodus').selectOption('around-clock');await expect(page.getByLabel('Startpunkte')).toHaveCount(0);await page.getByRole('button',{name:'Lobby eröffnen'}).click();
 await expect(page.getByRole('button',{name:'Spieler hinzufügen',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Match starten',exact:true}).click();
 await expect(page.locator('.game-player')).toHaveCount(1);await expect(page.locator('[data-player-score]')).toHaveText('1');
 await page.locator('.number-pad').getByRole('button',{name:'1',exact:true}).click();await expect(page.locator('[data-player-score]')).toHaveText('2');
 await page.locator('.number-pad').getByRole('button',{name:'3',exact:true}).click();await expect(page.locator('[data-player-score]')).toHaveText('2');
 await page.getByRole('button',{name:'↶ Zurück',exact:true}).click();await page.locator('.number-pad').getByRole('button',{name:'2',exact:true}).click();await expect(page.locator('[data-player-score]')).toHaveText('3');
 await expect(page.locator('.player-stats')).toContainText('2/21');await expect(page.locator('.player-stats')).toContainText('100.0 %');await expect(page.getByText('Match Average',{exact:true})).toHaveCount(0);
});

test('saved Autodarts board automatically scores both local sides without reconnecting on turn change',async({page})=>{
 const state=await setup(page);let socket:WebSocketRoute|undefined,connections=0;
 await page.route('**/api/autodarts**',r=>{
  const p=r.request().method()==='POST'?r.request().postDataJSON():null;
  return r.fulfill({json:!p?{canLink:true,authenticated:true,linked:true}:p.operation==='ticket'?{url:'wss://play.ws.autodarts.com/local',boardEmpty:true}:{boards:[{id:'local-board',name:'Board'}],boardId:'local-board',autoConnect:true}});
 });
 await page.route('**/api/game-image**',r=>r.fulfill({json:{image:null}}));
 await page.routeWebSocket('wss://play.ws.autodarts.com/**',ws=>{socket=ws;connections++;});
 await page.goto('/training');await page.getByRole('button',{name:'Lobby eröffnen'}).click();await page.getByRole('button',{name:'Spieler hinzufügen',exact:true}).click();
 await page.getByLabel('Lokaler Spieler',{exact:true}).fill('Bärbel');await page.getByRole('button',{name:'Lokal hinzufügen',exact:true}).click();await expect(page.getByText('Lokal',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Match starten',exact:true}).click();await expect.poll(()=>!!socket).toBe(true);
 const emit=(data:unknown,topic='events')=>socket!.send(JSON.stringify({channel:'autodarts.boards',topic:'local-board.'+topic,data}));
 const hit=(number:number,multiplier=1)=>emit({event:'Throw detected',throwNumber:1,throw:{segment:{number,multiplier},coords:{x:0,y:0}}});
 const clear=()=>{emit({event:'Takeout finished'});emit({numThrows:0},'state');};
 hit(25,2);await expect.poll(()=>state.game!.bull.some(Boolean)).toBe(true);clear();
 await expect(page.getByRole('heading',{name:'Bärbel wirft zum Ausbullen',exact:true})).toBeVisible();
 hit(25);await expect.poll(()=>state.game!.bull.every(Boolean)).toBe(true);clear();
 await expect.poll(()=>state.game!.phase).toBe('playing');
 hit(20);await expect.poll(()=>state.game!.current.length).toBe(1);clear();
 await expect.poll(()=>state.game!.turns.length).toBe(1);
 await expect(page.getByRole('heading',{name:'Bärbel ist am Zug',exact:true})).toBeVisible();
 hit(5);await expect.poll(()=>state.game!.current.length).toBe(1);
 const darts=state.requests.filter(p=>p.operation==='action'&&p.action.type==='dart');
 expect(darts.map(p=>p.actor)).toEqual(state.t.participants.map(p=>p.id));expect(connections).toBe(1);
});
