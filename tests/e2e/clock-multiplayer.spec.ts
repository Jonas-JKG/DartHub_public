import {test,expect,type Page,type WebSocketRoute} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {createTournament,type Tournament} from '../../src/domain/tournament';
import {createTrainingGame,gameAction,gameView,aroundClockView,keypadHit,type Game} from '../../src/domain/scoring';

async function setup(page:Page,remote=false){
 const account=randomUUID(),t:Tournament={...createTournament({id:randomUUID(),kind:'training',name:'Clock round',names:['Host','Player 2'],mode:'knockout',groupSize:2,advancePerGroup:1,scoring:{start:501,out:'single',legsToWin:1}},()=>0,randomUUID),trainingMode:'around-clock',managerId:account};
 for(let i=3;i<=6;i++)t.participants.push({id:randomUUID(),name:'Player '+i});
 const active=t.participants.map(()=>true);let game:Game|null=null,phase='waiting';const requests:any[]=[];
 const begin=()=>{const players=t.participants.filter((_,i)=>active[i]).map(p=>p.id);game=createTrainingGame(players,t.scoring!,false,'around-clock');game.sharedDevice=true;t.matches[0].players=players as [string,string,...string[]];t.matches[0].status='running';t.status='running';phase='playing';};
 const act=(actor:string,action:any)=>{game=gameAction(game!,actor,action);if(game.phase==='finished'){t.status='completed';t.winner=game.players[gameView(game).active];t.matches[0].status='finished';t.matches[0].winner=t.winner;t.version++;}};
 await page.addInitScript(()=>{localStorage.setItem('match-fullscreen','off');localStorage.setItem('match-input-mode','keyboard');});
 await page.route('**/api/identity',r=>r.fulfill({json:{signedIn:true,role:'owner'}}));
 await page.route('**/api/friends**',r=>r.fulfill({json:{account:true,friends:[],invitations:[]}}));
 await page.route('**/api/players**',r=>r.fulfill({json:{players:[]}}));
 await page.route('**/api/autodarts**',r=>r.fulfill({json:{canLink:true,authenticated:false}}));
 await page.route('**/api/game-image**',r=>r.fulfill({json:{image:null}}));
 await page.route('**/api/training**',r=>{
  if(r.request().method()==='POST'){
   const p=r.request().postDataJSON();requests.push(p);
   if(p.operation==='remove')active[t.participants.findIndex(m=>m.id===p.participantId)]=false;
   if(p.operation==='local'){const i=active.findIndex((a,i)=>i>0&&!a);if(i<0)return r.fulfill({status:409,json:{error:'Höchstens sechs Spieler möglich.'}});active[i]=true;t.participants[i].name=p.name;}
   if(p.operation==='start'){begin();return r.fulfill({json:{ok:true,redirect:'/training/'+t.id+'/games/'+t.matches[0].id}});}
   return r.fulfill({json:{ok:true}});
  }
  return r.fulfill({json:{account:true,accountId:account,host:true,canStart:true,modesReady:true,clockMultiplayerReady:true,participantIds:t.participants.filter((_,i)=>active[i]&&(!remote||i!==1)).map(p=>p.id),room:{id:t.id,phase,round:1,matchId:t.matches[0].id,tournament:t,game,lastResult:null,seats:t.participants.map((p,i)=>({position:i,participantId:p.id,local:i>0&&active[i]&&(!remote||i!==1),accountId:i===0?account:remote&&i===1?'remote-account':null,ready:active[i]}))}}});
 });
 await page.route(/\/api\/game(?:\?|$)/,r=>{
  if(r.request().method()==='POST'){
   const p=r.request().postDataJSON();if(p.operation==='presence')return r.fulfill({json:{ok:true}});requests.push(p);if(!(p.action?.type==='next'&&game?.phase==='finished'))act(p.actor,p.action);return r.fulfill({json:{ok:true,game}});
  }
  return r.fulfill({json:{tournament:t,match:t.matches[0],game,session:{role:'editor',tournamentId:t.id,participantId:t.participants[0].id,participantIds:t.participants.filter((_,i)=>active[i]&&(!remote||i!==1)).map(p=>p.id)}}});
 });
 return {t,begin,act,requests,get game(){return game;}};
}

test('six-player lobby replaces one local seat and displays only the current player in order',async({page})=>{
 const state=await setup(page);page.on('dialog',d=>void d.accept());await page.goto('/training/'+state.t.id);await expect(page.locator('.player-row')).toHaveCount(6);await expect(page.getByRole('button',{name:'Spieler hinzufügen',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Mitspieler entfernen',exact:true}).nth(2).click();await expect(page.locator('.player-row')).toHaveCount(5);await page.getByRole('button',{name:'Spieler hinzufügen',exact:true}).click();await page.getByLabel('Lokaler Spieler',{exact:true}).fill('Replacement');await page.getByRole('button',{name:'Lokal hinzufügen',exact:true}).click();await expect(page.locator('.player-row')).toHaveCount(6);
 await page.getByRole('button',{name:'Match starten',exact:true}).click();
 for(let i=0;i<6;i++){
  await expect(page.locator('.game-player')).toHaveCount(1);await expect(page.locator('.game-player h2')).toHaveText(state.t.participants[i].name);
  await page.locator('.number-pad').getByRole('button',{name:'1',exact:true}).click();await expect(page.locator('[data-player-score]')).toHaveText('2');await page.getByRole('button',{name:'Weiter →',exact:true}).click();
 }
 await expect(page.locator('.game-player h2')).toHaveText('Host');await expect(page.locator('[data-player-score]')).toHaveText('2');expect(state.requests.find(p=>p.operation==='remove').participantId).toBe(state.t.participants[3].id);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);await page.screenshot({path:'test-results/clock-six-'+page.viewportSize()!.width+'.png',fullPage:true});
});

test('a remote player keeps their own turn; the local device resumes on the next local side',async({page})=>{
 const state=await setup(page,true);await page.goto('/training/'+state.t.id);await page.getByRole('button',{name:'Match starten',exact:true}).click();await page.locator('.number-pad').getByRole('button',{name:'1',exact:true}).click();await page.getByRole('button',{name:'Weiter →',exact:true}).click();
 await expect(page.locator('.game-player h2')).toHaveText('Player 2');await expect(page.locator('.number-pad').getByRole('button',{name:'1',exact:true})).toBeDisabled();
 const id=state.t.participants[1].id;state.act(id,{type:'dart',hit:keypadHit(1,1)});state.act(id,{type:'next'});
 await expect(page.locator('.game-player h2')).toHaveText('Player 3');await expect(page.locator('.number-pad').getByRole('button',{name:'1',exact:true})).toBeEnabled();
});

test('the third player wins and the lobby retains all six individual results',async({page})=>{
 const state=await setup(page);state.begin();
 while(!(gameView(state.game!).active===2&&aroundClockView(state.game!).target===25)){
  const g=state.game!,actor=g.players[gameView(g).active],n=gameView(g).active===2?aroundClockView(g).target!:0;
  state.act(actor,{type:'dart',hit:keypadHit(n,1)});state.act(actor,{type:'next'});
 }
 await page.goto('/training/'+state.t.id+'/games/'+state.t.matches[0].id);await expect(page.locator('.game-player h2')).toHaveText('Player 3');await expect(page.locator('[data-player-score]')).toHaveText('Bull');await page.getByRole('button',{name:'Bull · 50',exact:true}).click();await page.locator('.celebration-actions').getByRole('button',{name:'Weiter →',exact:true}).click();await expect(page).toHaveURL('/training/'+state.t.id);
 await expect(page.locator('.compact-stats')).toContainText('Gewinner: Player 3');await expect(page.locator('.compact-stats tbody tr')).toHaveCount(6);await expect(page.locator('.compact-stats tbody tr').nth(2)).toContainText('21/21');
});

test('one saved Autodarts connection counts and advances through all six local players',async({page})=>{
 const state=await setup(page);let socket:WebSocketRoute|undefined,connections=0;
 await page.route('**/api/autodarts**',r=>{const p=r.request().method()==='POST'?r.request().postDataJSON():null;return r.fulfill({json:!p?{canLink:true,authenticated:true,linked:true}:p.operation==='ticket'?{url:'wss://play.ws.autodarts.com/clock',boardEmpty:true}:{boards:[{id:'clock-board',name:'Board'}],boardId:'clock-board',autoConnect:true}});});
 await page.routeWebSocket('wss://play.ws.autodarts.com/**',ws=>{socket=ws;connections++;});
 await page.goto('/training/'+state.t.id);await page.getByRole('button',{name:'Match starten',exact:true}).click();await expect.poll(()=>!!socket).toBe(true);
 const emit=(data:unknown,topic='events')=>socket!.send(JSON.stringify({channel:'autodarts.boards',topic:'clock-board.'+topic,data}));
 for(let i=0;i<6;i++){
  await expect(page.locator('.game-player h2')).toHaveText(state.t.participants[i].name);emit({event:'Throw detected',throwNumber:1,throw:{segment:{number:1,multiplier:1},coords:{x:.2,y:.1}}});await expect(page.locator('[data-player-score]')).toHaveText('2');emit({event:'Takeout finished'});emit({numThrows:0},'state');
 }
 await expect(page.locator('.game-player h2')).toHaveText('Host');expect(state.game!.turns.map(t=>t.player)).toEqual([0,1,2,3,4,5]);expect(connections).toBe(1);
});

test('spectator link shows only the active Around-the-Clock player without private navigation',async({page})=>{
 const state=await setup(page);state.begin();
 await page.route('**/api/watch**',r=>{const g=state.game!,v=gameView(g);return r.fulfill({json:{tournament:state.t,games:[{id:state.t.matches[0].id,players:g.players,phase:g.phase,practice:g.practice,active:v.active,remaining:v.remaining,completed:g.players.map((_,i)=>aroundClockView(g,i).completed),darts:v.darts}]}});});
 await page.goto('/watch/'+'a'.repeat(43));await expect(page.locator('.clock-spectator h2')).toHaveText('Host');await expect(page.getByRole('navigation')).toHaveCount(0);await expect(page.getByRole('link',{name:'Anmelden',exact:true})).toBeVisible();
 state.act(state.game!.players[0],{type:'dart',hit:keypadHit(1,1)});state.act(state.game!.players[0],{type:'next'});await expect(page.locator('.clock-spectator h2')).toHaveText('Player 2');await expect(page.locator('.clock-spectator')).toHaveCount(1);
});

test('a winning Autodarts takeout keeps result confirmation usable and opens statistics',async({page})=>{
 const state=await setup(page);state.begin();
 while(!(gameView(state.game!).active===2&&aroundClockView(state.game!).target===25)){
  const g=state.game!,actor=g.players[gameView(g).active];state.act(actor,{type:'dart',hit:keypadHit(gameView(g).active===2?aroundClockView(g).target!:0,1)});state.act(actor,{type:'next'});
 }
 let socket:WebSocketRoute|undefined;
 await page.route('**/api/autodarts**',r=>{const p=r.request().method()==='POST'?r.request().postDataJSON():null;return r.fulfill({json:!p?{canLink:true,authenticated:true,linked:true}:p.operation==='ticket'?{url:'wss://play.ws.autodarts.com/clock',boardEmpty:true}:{boards:[{id:'clock-board',name:'Board'}],boardId:'clock-board',autoConnect:true}});});
 await page.routeWebSocket('wss://play.ws.autodarts.com/**',ws=>{socket=ws;});
 await page.goto('/training/'+state.t.id+'/games/'+state.t.matches[0].id);await expect.poll(()=>!!socket).toBe(true);
 const emit=(data:unknown)=>socket!.send(JSON.stringify({channel:'autodarts.boards',topic:'clock-board.events',data}));
 emit({event:'Throw detected',throwNumber:1,throw:{segment:{number:25,multiplier:2},coords:{x:0,y:0}}});await expect(page.locator('.celebration-actions').getByRole('button',{name:'Weiter →',exact:true})).toBeVisible();
 emit({event:'Takeout finished'});emit({event:'Takeout finished'});await expect(page.locator('.celebration-actions').getByRole('button',{name:'Weiter →',exact:true})).toBeEnabled();expect(state.game!.phase).toBe('playing');
 await page.locator('.celebration-actions').getByRole('button',{name:'Weiter →',exact:true}).click();await expect(page).toHaveURL('/training/'+state.t.id);await expect(page.locator('.compact-stats tbody tr')).toHaveCount(6);
 expect(state.requests.filter(p=>p.action?.type==='next')).toHaveLength(1);
});

test('English dart displays keep their width for empty slots, Miss and triple labels',async({page})=>{
 const state=await setup(page);state.begin();await page.addInitScript(()=>localStorage.setItem('dartbracket-language','en'));
 await page.goto('/training/'+state.t.id+'/games/'+state.t.matches[0].id);await expect(page.locator('.visit-total')).toContainText('Darts this turn');
 const widths=()=>page.locator('.visit-darts button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().width));const before=await widths();const panel=await page.locator('.game-player').boundingBox();
 await page.getByRole('button',{name:'Miss',exact:true}).click();await expect(page.locator('.visit-darts strong').first()).toHaveText('Miss');await page.getByRole('button',{name:'Triple',exact:true}).click();await page.locator('.number-pad').getByRole('button',{name:'20',exact:true}).click();
 const after=await widths();after.forEach((n,i)=>expect(Math.abs(n-before[i])).toBeLessThan(1));expect((await page.locator('.game-player').boundingBox())!.width).toBe(panel!.width);await expect(page.locator('.visit-total strong')).toHaveText('2 / 3');
 expect(await page.locator('.visit-darts').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
});

for(const responseLost of [false,true])test('winner confirmation keeps save failures visible and X retries safely; response lost='+responseLost,async({page})=>{
 const state=await setup(page);state.begin();
 while(!(gameView(state.game!).active===2&&aroundClockView(state.game!).target===25)){
  const g=state.game!,actor=g.players[gameView(g).active];state.act(actor,{type:'dart',hit:keypadHit(gameView(g).active===2?aroundClockView(g).target!:0,1)});state.act(actor,{type:'next'});
 }
 let rejected=false;
 await page.route(/\/api\/game(?:\?|$)/,async route=>{
  const p=route.request().method()==='POST'?route.request().postDataJSON():null;
  if(!rejected&&p?.action?.type==='next'){
   rejected=true;if(responseLost)state.act(p.actor,p.action);
   return route.fulfill({status:responseLost?403:503,json:{error:responseLost?'Sitzung abgelaufen oder keine Berechtigung. Bitte erneut anmelden.':'Ergebnis konnte nicht gespeichert werden.'}});
  }
  return route.fallback();
 });
 await page.goto('/training/'+state.t.id+'/games/'+state.t.matches[0].id);await page.getByRole('button',{name:'Bull · 50',exact:true}).click();await page.locator('.celebration-actions').getByRole('button',{name:'Weiter →',exact:true}).click();
 if(!responseLost){await expect(page.locator('.leg-celebration [role="alert"]')).toContainText('Ergebnis konnte nicht gespeichert werden.');await expect(page.locator('.leg-celebration')).toBeVisible();
 await page.getByRole('button',{name:'Siegesanzeige schließen',exact:true}).click();}await expect(page).toHaveURL('/training/'+state.t.id);await expect(page.locator('.compact-stats')).toContainText('Gewinner: Player 3');expect(state.game!.phase).toBe('finished');
});
