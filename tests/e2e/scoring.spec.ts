import { test,expect,type Page,type Browser,type WebSocketRoute } from '@playwright/test';
import { randomInt,randomUUID } from 'node:crypto';
import { createTournament,updateMatch,type Tournament } from '../../src/domain/tournament';
import { createGame,gameAction,gameView,keypadHit,points,type Game } from '../../src/domain/scoring';
async function room(browser:Browser,page:Page,legsToWin=1,out:'single'|'double'='double',nearFinish:boolean|'setup'|'checkout'=false,bullStart=false,shared:boolean|'accounts'=false) {
  let t=createTournament({id:randomUUID(),name:'Live am Oche',names:['Jonas','Leon','Anton','Saru'],mode:'knockout',groupSize:4,advancePerGroup:2,scoring:{start:301,out,legsToWin}},randomInt,randomUUID);
  t.status='running';t.startedAt=new Date().toISOString();const match=t.matches[0],players=match.players as [string,string];
  let g=createGame(players,t.scoring!);if(!bullStart){g=gameAction(g,players[0],{type:'bull',hit:keypadHit(25,2)});g=gameAction(g,players[1],{type:'bull',hit:keypadHit(25,1)});g=gameAction(g,players[0],{type:'next'});g=gameAction(g,players[1],{type:'next'});}
  if(nearFinish){
    for(const hit of nearFinish==='checkout'?[keypadHit(20,3),keypadHit(20,3),keypadHit(11,1)]:nearFinish==='setup'?[keypadHit(20,3),keypadHit(20,3),keypadHit(2,1)]:[keypadHit(20,3),keypadHit(19,3),keypadHit(18,3)])g=gameAction(g,players[0],{type:'dart',hit});
    g=gameAction(g,players[0],{type:'next'});g=gameAction(g,players[1],{type:'dart',hit:keypadHit(0,1)});g=gameAction(g,players[1],{type:'next'});
    if(nearFinish!=='setup'&&nearFinish!=='checkout')for(const hit of [keypadHit(20,3),keypadHit(25,2)])g=gameAction(g,players[0],{type:'dart',hit});
  }
  let writes=0;
  async function attach(p:Page,player:string) {
    await p.route('**/api/identity',r=>r.fulfill({json:{signedIn:true,role:'owner'}}));
    await p.route('**/api/autodarts',r=>r.fulfill({json:{authenticated:false}}));
    await p.route('**/api/game**',async route=>{
      if(route.request().method()==='GET'){await route.fulfill({json:{sharedDevice:shared==='accounts'&&player===players[0],tournament:t,match:t.matches[0],game:g,session:{role:'editor',tournamentId:t.id,participantId:player,participantIds:shared&&player===players[0]?players:[player]}}});return;}
      const input=route.request().postDataJSON();if(input.operation==='presence'){await route.fulfill({json:{ok:true}});return;}writes++;
      try {
        if(input.expectedVersion!==g.version){await route.fulfill({status:409,json:{error:'Spielstand inzwischen geändert.',conflict:true}});return;}
        if(input.actor&&input.actor!==player&&!(shared&&player===players[0]&&players.includes(input.actor)))throw Error('Keine Berechtigung');
        g=gameAction(g,input.actor??player,input.action);
        if(g.phase==='finished'){t=updateMatch(t,match.id,{legs:[gameView(g).legs[0],gameView(g).legs[1]],status:'finished',forfeited:null}).tournament;t.version++;}
        await route.fulfill({json:{ok:true,game:g}});
      }catch(e){await route.fulfill({status:403,json:{error:e instanceof Error?e.message:'Keine Berechtigung'}});}
    });
    await p.route('**/api/game-image**',r=>r.fulfill({json:{image:null}}));
    await p.route('**/api/app**',r=>r.fulfill({json:{setup:false,tournaments:[t],liveId:t.id,appOrigin:'http://localhost:3000',session:{role:'editor',tournamentId:t.id,participantId:player}}}));
    await p.route('**/*.supabase.co/**',r=>r.abort());
    await p.goto(`/tournaments/${t.id}/games/${match.id}`);
  }
  const contextB=await browser.newContext({viewport:page.viewportSize()??undefined}),pB=await contextB.newPage();
  const contextS=await browser.newContext({viewport:page.viewportSize()??undefined}),pS=await contextS.newPage();
  await attach(page,players[0]);await attach(pB,players[1]);await attach(pS,t.participants.find(p=>!players.includes(p.id))!.id);
  return {get g(){return g;},get t(){return t;},get writes(){return writes;},pB,pS,close:async()=>{await contextB.close();await contextS.close();}};
}
async function dart(p:Page,n:number,m:1|2|3) {
  const before=await p.locator('.player-0 .visit-darts strong').allTextContents();
  if((p.viewportSize()?.width??1000)<=760){
    await p.getByRole('button',{name:m===1?'Single':m===2?'Double':'Triple',exact:true}).click();
    await p.locator('.number-pad').getByRole('button',{name:String(n),exact:true}).click();
  }else await p.locator(`.dartboard [data-field="${m===3?'T':m===2?'D':'S'}${n}"]`).last().click();
  await expect.poll(()=>p.locator('.player-0 .visit-darts strong').allTextContents()).not.toEqual(before);
}
async function confirmVisit(page:Page,player=0){const victory=page.locator('.celebration-actions').getByRole('button',{name:/^(Weiter →|Nächstes Leg)$/});if(await victory.isVisible())await victory.click();else await page.locator('.player-'+player).getByRole('button',{name:'Weiter'}).click();}
test('zwei Spieler und Zuschauer sehen gleiche Treffer, Korrekturen und Abschluss',async({page,browser},info)=>{
  const state=await room(browser,page);
  try{
    await expect(page.locator('.player-0')).toHaveClass(/at-oche/);
    await dart(page,20,3);
    await expect(page.locator('[data-player-score="0"]')).toHaveText('241');
    await expect(state.pB.locator('[data-player-score="0"]')).toHaveText('241');
    await expect(state.pS.locator('[data-player-score="0"]')).toHaveText('241');
    if(info.project.name==='desktop'){
      await expect(state.pB.locator('[data-marker="1"]')).toHaveCount(1);
      const a=await page.locator('[data-marker="1"] circle').getAttribute('cx'),b=await state.pB.locator('[data-marker="1"] circle').getAttribute('cx');
      expect(a).toBe(b);
    }else{await expect(page.locator('.board-area')).toBeHidden();await expect(page.locator('.number-pad')).toBeVisible();}
    await expect(state.pS.locator('.game-player-actions button:not([disabled])')).toHaveCount(0);
    await page.screenshot({path:`test-results/${info.project.name}-live-scoring.png`,fullPage:true});
    await dart(page,20,3);await dart(page,20,3);
    await confirmVisit(page);
    await expect(state.pB.locator('.player-1')).toHaveClass(/at-oche/);
    await expect(page.locator('.player-0').getByRole('button',{name:'Zurück'})).toBeDisabled();
    await state.pB.locator('.player-1').getByRole('button',{name:'Zurück'}).click();
    await expect(page.locator('.player-0')).toHaveClass(/at-oche/);
    await page.locator('.player-0').getByRole('button',{name:'Zurück'}).click();
    await expect(page.locator('[data-player-score="0"]')).toHaveText('181');
    await dart(page,20,3);await confirmVisit(page);
    await expect(state.pB.locator('.player-1')).toHaveClass(/at-oche/);
    if(await state.pB.getByRole('button',{name:'Mit Zahlentastatur eingeben'}).isVisible())await state.pB.getByRole('button',{name:'Mit Zahlentastatur eingeben'}).click();
    await state.pB.getByRole('button',{name:'Miss',exact:true}).click();
    await state.pB.locator('.player-1').getByRole('button',{name:'Weiter'}).click();
    await expect(page.locator('.player-0')).toHaveClass(/at-oche/);
    for(const p of [page,state.pB,state.pS])await p.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
    await dart(page,20,3);await dart(page,11,3);await dart(page,14,2);
    await expect(page.locator('[data-player-score="0"]')).toHaveText('0');
    expect(state.g.phase).toBe('playing');
    await confirmVisit(page);
    for(const p of [page,state.pB,state.pS])await p.clock.fastForward(25500);
    const target=new RegExp(`/tournaments/${state.t.id}$`);
    await expect(page).toHaveURL(target,{timeout:9000});await expect(state.pB).toHaveURL(target,{timeout:9000});await expect(state.pS).toHaveURL(target,{timeout:9000});
    expect(state.t.matches[0].legs).toEqual([1,0]);expect(state.g.phase).toBe('finished');
  }finally{await state.close();}
});
test('Spielerkonto öffnet ausschließlich die fest zugeordneten Teilnehmer ohne Spielerwechsel',async({page})=>{await page.route('**/api/identity',r=>r.fulfill({json:{signedIn:true,role:'owner'}}));const t={...createTournament({id:randomUUID(),name:'Kontozuordnung',names:['Jonas','Leon','Anton'],mode:'knockout',groupSize:4,advancePerGroup:2},randomInt,randomUUID),managerId:randomUUID(),linkedParticipantIds:[] as string[]};t.linkedParticipantIds=[t.participants[0].id];const writes:unknown[]=[];await page.route('**/api/app**',r=>{if(r.request().method()==='POST')writes.push(r.request().postDataJSON());return r.fulfill({json:{setup:false,accountsEnabled:true,tournaments:[t],session:{role:'owner',managerId:randomUUID(),participantId:t.participants[0].id,participantIds:[t.participants[0].id],playingTournamentId:t.id}}});});await page.goto('/tournaments/'+t.id);await expect(page.locator('.participant-list')).toContainText('Jonas');await expect(page.getByRole('link',{name:/Spieler wechseln|Spieler wählen/})).toHaveCount(0);await expect(page.getByRole('button',{name:'Einstellungen',exact:true})).toHaveCount(0);expect(writes).toEqual([]);});
test('neues Leg leert beide Aufnahmen und Leg-Statistiken; Match-Average bleibt',async({page,browser})=>{
  const state=await room(browser,page,2);
  try {
    await dart(page,20,3);await dart(page,20,3);await dart(page,20,3);
    await confirmVisit(page);
    await expect(state.pB.locator('.player-1')).toHaveClass(/at-oche/);
    if((page.viewportSize()?.width??1000)>760)await state.pB.getByRole('button',{name:'Mit Zahlentastatur eingeben'}).click();
    await state.pB.getByRole('button',{name:'Miss',exact:true}).click();await state.pB.locator('.player-1').getByRole('button',{name:'Weiter'}).click();
    await expect(page.locator('.player-0')).toHaveClass(/at-oche/);
    await dart(page,20,3);await dart(page,11,3);await dart(page,14,2);
    await expect(page.locator('.leg-celebration')).toContainText('LEG 1 GEWONNEN');
    await expect(state.pB.locator('.leg-celebration')).toContainText('LEG 1 GEWONNEN');
    await confirmVisit(page);
    await expect(page.getByRole('heading',{name:/ist am Zug/})).toBeVisible();
    await expect(page.locator('.player-0 .leg-score strong')).toHaveText('1');
    await expect(page.locator('.player-1')).toHaveClass(/at-oche/);
    for(const player of [0,1]){
      await expect(page.locator(`.player-${player} .visit-darts strong`)).toHaveText(['—','—','—']);
      await expect(page.locator(`.player-${player} .visit-total>strong`)).toHaveText('0');
      await expect(page.locator(`.player-${player} .player-stats strong`).nth(0)).toHaveText('0.0');
      await expect(page.locator(`.player-${player} .player-stats strong`).nth(2)).toHaveText('0');
    }
    await expect(page.locator('.player-0 .player-stats strong').nth(1)).toHaveText('150.5');
  }finally{await state.close();}
});
for(const out of ['single','double'] as const)test(`Empfehlung im dritten Dartfeld berücksichtigt ${out} Out`,async({page,browser},info)=>{
  const state=await room(browser,page,2,out,true);
  try {
    await expect(page.locator('.player-0 .visit-darts strong')).toHaveText(['60','50',out==='double'?'D10':'S20']);
    await expect(page.locator('.player-0 .visit-darts button').nth(2)).toHaveClass(/has-recommendation/);
    await page.screenshot({path:`test-results/${info.project.name}-${out}-checkout.png`,fullPage:true});
    await dart(page,out==='double'?10:20,out==='double'?2:1);
    await expect(page.locator('.player-0 .visit-darts strong').nth(2)).toHaveText('20');
    await expect(page.locator('.leg-celebration')).toBeVisible();
    await page.getByRole('button',{name:'Dart korrigieren',exact:true}).click();
    await expect(page.locator('.leg-celebration')).toHaveCount(0);
    await expect(page.locator('.player-0 .visit-darts strong').nth(2)).toHaveText(out==='double'?'D10':'S20');
  }finally{await state.close();}
});

test('Ausbullen zeigt Treffer live und wartet auf beide Weiter-Bestätigungen',async({page,browser},info)=>{
  const state=await room(browser,page,2,'double',false,true);
  try {
    async function bull(p:Page,score:25|50){
      if((p.viewportSize()?.width??1000)<=760)await p.locator('.mobile-bull').getByRole('button',{name:score===50?'Bull · 50':'25',exact:true}).click();
      else if(score===50)await p.locator('.dartboard [data-field="Bull"]').click();
      else {const ring=p.locator('.dartboard [data-field="25"]'),box=(await ring.boundingBox())!;await ring.click({position:{x:box.width*.85,y:box.height*.5}});}
    }
    await expect(page.locator('.player-0').getByRole('button',{name:'Weiter'})).toBeDisabled();
    await bull(page,50);await expect(state.pB.locator('.player-0 .bull-result strong')).toHaveText('Bull');await bull(state.pB,25);
    await expect(page.locator('.player-1 .bull-result')).toContainText('25');
    await expect(page.getByRole('heading',{name:'Wer beginnt?'})).toBeVisible();
    if(info.project.name==='desktop'){
      await expect(page.locator('[data-marker="A"] circle')).toHaveAttribute('r','3.5');
      await expect(page.locator('.dartboard circle[r="176"]')).toHaveCount(0);
    }
    await page.screenshot({path:`test-results/${info.project.name}-bull-confirm.png`,fullPage:true});
    await confirmVisit(page);
    await expect(page.locator('.player-0 .bull-result')).toContainText('Bestätigt');
    await expect(page.getByRole('heading',{name:'Wer beginnt?'})).toBeVisible();
    await page.locator('.player-0').getByRole('button',{name:'Zurück'}).click();
    await expect(page.locator('.player-0 .bull-result')).toContainText('Treffer noch offen');await expect(state.pB.locator('.player-0 .bull-result')).toContainText('Treffer noch offen');
    await bull(page,50);await confirmVisit(page);
    await expect(state.pB.locator('.player-0 .bull-result')).toContainText('Bestätigt');
    await state.pB.locator('.player-1').getByRole('button',{name:'Weiter'}).click();
    await expect(page.locator('.player-0')).toHaveClass(/at-oche/);await expect(state.pB.locator('.player-0')).toHaveClass(/at-oche/);
  }finally{await state.close();}
});
for(const out of ['single','double'] as const)test(`Stell-Empfehlung bei 179 Rest für ${out} Out`,async({page,browser},info)=>{
  const state=await room(browser,page,2,out,'setup');
  try {
    await expect(page.locator('.checkout-line')).toContainText(out==='double'?'STELLEN AUF 32':'STELLEN AUF 20');
    await expect(page.locator('.player-0 .visit-darts .has-recommendation')).toHaveCount(3);
    await dart(page,20,3);await expect(page.locator('[data-player-score="0"]')).toHaveText('119');
    await expect(page.locator('.checkout-line')).toContainText('STELLEN AUF');
    await page.screenshot({path:`test-results/${info.project.name}-${out}-setup.png`,fullPage:true});
  }finally{await state.close();}
});


async function connectAutodarts(p:Page,board:string,sockets:Map<string,WebSocketRoute>,withImages=false,bootstrap=false){
    let authenticated=false;await p.route('**/api/autodarts',r=>{const body=r.request().method()==='POST'?r.request().postDataJSON():null;if(body?.operation==='login')authenticated=true;return r.fulfill({json:!body?{authenticated}:body?.operation==='ticket'?{url:'wss://play.ws.autodarts.com/ms/v0/subscribe?code='+board,boardEmpty:bootstrap}:withImages&&body?.operation==='image'?{url:'https://boards.ws.autodarts.com/image/'+board+'.jpg'}:{boards:[{id:board,name:board}]}});});
    await p.routeWebSocket('wss://play.ws.autodarts.com/**',ws=>{sockets.set(board,ws);ws.onMessage(raw=>{const m=JSON.parse(String(raw));if(!bootstrap&&m.topic===board+'.state')ws.send(JSON.stringify({channel:'autodarts.boards',topic:board+'.state',data:{numThrows:0}}));});});
    await p.getByRole('button',{name:'Match-Einstellungen',exact:true}).click();await p.locator('.autodarts-heading').click();await p.getByLabel('Autodarts E-Mail').fill('test@example.com');await p.getByLabel('Autodarts Passwort',{exact:true}).fill('fake-test-password');await p.getByRole('button',{name:'Bei Autodarts anmelden',exact:true}).click();await p.getByRole('button',{name:'Meine Scheibe verbinden',exact:true}).click();await expect(p.locator('.autodarts-heading')).toContainText('Board-Daten empfangen');await p.getByRole('button',{name:'Einstellungen schließen',exact:true}).click();
  }

test('experimentelle Cloud-Verbindung filtert zwei eigene Boards und verarbeitet eine Aufnahme seriell',async({page,browser})=>{
  const state=await room(browser,page);
  const sockets=new Map<string,WebSocketRoute>();
  const connect=(p:Page,board:string)=>connectAutodarts(p,board,sockets);
  const send=(socket:string,board:string,n:number)=>{sockets.get(socket)!.send(JSON.stringify({channel:'autodarts.boards',topic:board+'.state',data:{numThrows:n,event:n?'Throw detected':'Takeout finished'}}));for(let i=1;i<=n;i++)sockets.get(socket)!.send(JSON.stringify({channel:'autodarts.boards',topic:board+'.events',data:{boardId:board,event:'Throw detected',throwNumber:i,throw:{segment:{number:20,multiplier:3}}}}));};
  try{
    await connect(page,'board-a');await connect(state.pB,'board-b');
    sockets.get('board-a')!.send(JSON.stringify({type:'error',channel:'autodarts.boards.images',topic:'board-a.live?cam=0&warp=true'}));
    send('board-a','wrong-board',1);send('board-b','board-b',1);await expect(state.pB.locator('.autodarts-heading')).toContainText('Aktuell keine Eingabe für dich');expect(state.g.current).toHaveLength(0);
    send('board-a','board-a',3);await expect(page.locator('[data-player-score="0"]')).toHaveText('121');expect(state.g.current).toHaveLength(3);expect(state.g.turns).toHaveLength(0);
    send('board-a','board-a',3);await expect(state.pB.locator('[data-player-score="0"]')).toHaveText('121');expect(state.g.current).toHaveLength(3);
    sockets.get('board-a')!.send(JSON.stringify({channel:'autodarts.boards',topic:'board-a.state',data:{numThrows:0,event:'Takeout started'}}));await expect(page.locator('.autodarts-heading')).toContainText('Scheibe leer');expect(state.g.turns).toHaveLength(0);
    send('board-a','board-a',0);await expect(state.pB.locator('.player-1')).toHaveClass(/at-oche/);expect(state.g.turns).toHaveLength(1);
    sockets.get('board-a')!.send(JSON.stringify({channel:'autodarts.boards',topic:'board-a.events',data:{event:'Takeout finished'}}));
    send('board-b','board-b',1);await expect(state.pB.locator('[data-player-score="1"]')).toHaveText('301');expect(state.g.current).toHaveLength(0);
    send('board-b','board-b',0);await expect(state.pB.locator('.autodarts-heading')).toContainText('Scheibe leer');send('board-b','board-b',1);
    await expect(state.pB.locator('[data-player-score="1"]')).toHaveText('241');await expect(page.locator('[data-player-score="1"]')).toHaveText('241');
    await state.pB.locator('.player-1').getByRole('button',{name:'Weiter'}).click();await expect(page.locator('.player-0')).toHaveClass(/at-oche/);send('board-b','board-b',0);await expect(state.pB.locator('.autodarts-heading')).toContainText('Scheibe leer');expect(state.g.turns).toHaveLength(2);
    await page.screenshot({path:'test-results/autodarts-cloud-'+((page.viewportSize()?.width??1000)>760?'desktop':'mobile')+'.png',fullPage:true});
  }finally{await state.close();}
});


test('Caller summiert die Darts einmal und lässt den zufälligen Walk-on unabhängig laufen',async({page,browser},info)=>{
  test.skip(process.env.NEXT_PUBLIC_CALLER_PACK_ENABLED!=='true','Requires a separately installed licensed caller pack');
  await page.addInitScript(()=>{
    localStorage.setItem('caller-enabled','off');(window as unknown as {audioLog:string[]}).audioLog=[];
    HTMLMediaElement.prototype.play=function(){const element=this;(window as unknown as {audioLog:string[]}).audioLog.push((element.getAttribute('data-audio-channel')??'')+':'+element.getAttribute('src'));const source=element.getAttribute('src');if(element.getAttribute('data-audio-channel')==='caller')setTimeout(()=>{if(element.getAttribute('src')===source)element.dispatchEvent(new Event('ended'));},10);return Promise.resolve();};
    HTMLMediaElement.prototype.pause=function(){(window as unknown as {audioLog:string[]}).audioLog.push('pause:'+this.getAttribute('data-audio-channel'));};
  });
  const state=await room(browser,page);
  const log=()=>page.evaluate(()=>(window as unknown as {audioLog:string[]}).audioLog);
  try{
    await page.evaluate(()=>(window as unknown as {audioLog:string[]}).audioLog=[]);
    await page.getByRole('button',{name:'Match-Einstellungen',exact:true}).click();await page.getByRole('button',{name:'Ton aktivieren',exact:true}).click();await expect(page.getByRole('button',{name:'Walk-on stoppen',exact:true,includeHidden:true})).toBeVisible();
    await expect.poll(async()=>(await log()).filter(v=>v.startsWith('music:/audio/walk-on/')).length).toBe(1);
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.getByRole('button',{name:'Match-Einstellungen',exact:true})).toBeFocused();
    await dart(page,20,3);await dart(page,20,3);expect((await log()).filter(v=>v==='caller:/audio/caller/180.wav')).toHaveLength(0);
    await dart(page,20,3);await expect.poll(async()=>(await log()).filter(v=>v==='caller:/audio/caller/180.wav').length).toBe(1);
    await confirmVisit(page);await expect(state.pB.locator('.player-1')).toHaveClass(/at-oche/);
    expect((await log()).filter(v=>v==='caller:/audio/caller/180.wav')).toHaveLength(1);expect((await log()).filter(v=>v==='pause:music')).toHaveLength(0);
    await page.getByRole('button',{name:'Match-Einstellungen',exact:true}).click();await page.getByRole('button',{name:'Caller ausschalten',exact:true,includeHidden:true}).click();await expect(page.getByRole('button',{name:'Walk-on stoppen',exact:true,includeHidden:true})).toBeVisible();expect((await log()).filter(v=>v==='pause:music')).toHaveLength(0);
    await page.getByRole('button',{name:'Walk-on stoppen',exact:true,includeHidden:true}).click();expect((await log()).filter(v=>v==='pause:music')).toHaveLength(1);
    await page.locator('.autodarts-heading').click();await expect(page.getByText('Ohne Kameras testen',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:/Testwurf/})).toHaveCount(0);
    const menu=await page.getByRole('dialog').boundingBox();expect(menu?.y).toBe(0);expect(menu?.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({path:'test-results/'+info.project.name+'-caller.png'});
  }finally{await state.close();}
});

test('synthesized intro and silence decode in the browser',async({page})=>{
  await page.goto('/');
  const decoded=await page.evaluate(async()=>{
    const context=new AudioContext(),files=['/audio/silence.wav','/audio/walk-on/intro.mp3'];
    try{const result=[];for(const file of files){const response=await fetch(file);if(!response.ok)throw Error(file+' '+response.status);const data=await response.arrayBuffer();let buffer:AudioBuffer;try{buffer=await context.decodeAudioData(data);}catch{throw Error('Audio konnte nicht dekodiert werden: '+file);}result.push({file,duration:buffer.duration});}return result;}finally{await context.close();}
  });
  expect(decoded).toHaveLength(2);for(const clip of decoded)expect(clip.duration).toBeGreaterThanOrEqual(.1);
});


test('You require 170 wird aus deinen Dateien nacheinander und nur zum Zugbeginn abgespielt',async({page,browser})=>{
  test.skip(process.env.NEXT_PUBLIC_CALLER_PACK_ENABLED!=='true','Requires a separately installed licensed caller pack');
  await page.addInitScript(()=>{
    localStorage.setItem('caller-enabled','off');(window as unknown as {audioLog:string[]}).audioLog=[];
    HTMLMediaElement.prototype.play=function(){const element=this,source=element.getAttribute('src');(window as unknown as {audioLog:string[]}).audioLog.push(source??'');if(element.getAttribute('data-audio-channel')==='caller')setTimeout(()=>{if(element.getAttribute('src')===source)element.dispatchEvent(new Event('ended'));},10);return Promise.resolve();};HTMLMediaElement.prototype.pause=function(){};
  });
  const state=await room(browser,page,1,'double','checkout');
  const calls=()=>page.evaluate(()=>(window as unknown as {audioLog:string[]}).audioLog.filter(v=>v.includes('/caller/')));
  try{
    await expect(page.locator('[data-player-score="0"]')).toHaveText('170');await page.getByRole('button',{name:'Match-Einstellungen',exact:true}).click();await page.getByRole('button',{name:'Ton aktivieren',exact:true}).click();
    await expect.poll(calls).toEqual(['/audio/caller/You_require.m4a','/audio/caller/170.wav']);
    await page.getByRole('button',{name:'Einstellungen schließen',exact:true}).click();await dart(page,20,3);await expect(page.locator('[data-player-score="0"]')).toHaveText('110');expect(await calls()).toEqual(['/audio/caller/You_require.m4a','/audio/caller/170.wav']);
  }finally{await state.close();}
});

test('Autodarts setzt genaue Punkte beim Ausbullen und im Match auf allen Geräten',async({page,browser})=>{
 const state=await room(browser,page,2,'double',false,true),sockets=new Map<string,WebSocketRoute>();
 const hit=(board:string,x:number,y:number)=>sockets.get(board)!.send(JSON.stringify({channel:'autodarts.boards',topic:board+'.events',data:{boardId:board,event:'Throw detected',throwNumber:1,throw:{coords:{x,y},segment:{number:20,multiplier:1}}}}));
 const empty=(board:string)=>sockets.get(board)!.send(JSON.stringify({channel:'autodarts.boards',topic:board+'.events',data:{boardId:board,event:'Takeout finished'}}));
 try{
  await connectAutodarts(page,'board-a',sockets,false,true);await connectAutodarts(state.pB,'board-b',sockets,false,true);
  // No initial WebSocket empty event and no sacrificial throw: the HTTP state arms the first bull dart.
  hit('board-a',.02,.12);await expect(page.locator('.player-0 .bull-result strong')).toHaveText('20.7 mm');
  hit('board-b',.04,.2);await expect(state.pB.locator('.player-1 .bull-result strong')).toHaveText('34.7 mm');await expect(page.locator('.player-1 .bull-result strong')).toHaveText('34.7 mm');
  await expect(state.pB.locator('[data-marker="A"] circle')).toHaveAttribute('cx','223.4');await expect(state.pB.locator('[data-marker="A"] circle')).toHaveAttribute('cy','199.6');
  empty('board-a');await expect(page.locator('.player-0 .bull-result')).toContainText('Bestätigt');empty('board-b');await expect(page.locator('.player-0')).toHaveClass(/at-oche/);
  hit('board-a',.08,.4);await expect(page.locator('[data-player-score="0"]')).toHaveText('281');
  for(const p of [page,state.pB,state.pS]){await expect(p.locator('[data-marker="1"] circle')).toHaveAttribute('cx','233.6');await expect(p.locator('[data-marker="1"] circle')).toHaveAttribute('cy','152');}
 }finally{await state.close();}
});


test('Kamerabild wird zwischen beiden Boards und manueller Scheibe auf allen Geräten gewechselt',async({page,browser},info)=>{
 const state=await room(browser,page,2),sockets=new Map<string,WebSocketRoute>();
 const pictures=await page.evaluate(()=>{return ['#aa4433','#3355aa'].map(color=>{const c=document.createElement('canvas');c.width=c.height=440;const ctx=c.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,440,440);return c.toDataURL('image/jpeg');});});
 const frames=new Map<string,{image:string;visit:string;etag:string}>(),baselines=new Map<string,string>();let sequence=0,readMode='normal',reads=0;
 for(const [p,player] of [[page,state.g.players[0]],[state.pB,state.g.players[1]],[state.pS,'spectator']] as const){
  await p.route('**/api/game-image**',async r=>{
   if(r.request().method()==='POST'){
    const b=r.request().postDataJSON();if(b.operation==='clear'){frames.delete(player);baselines.delete(player);}if(b.operation==='frame'&&b.empty)baselines.set(player,b.url.includes('board-b')?pictures[1]:pictures[0]);
    if(b.operation==='frame'&&(state.g.phase==='bull'||state.g.players[gameView(state.g).active]===player)&&b.visit===state.g.phase+':'+state.g.turns.length)frames.set(player,{image:b.url.includes('board-b')?pictures[1]:pictures[0],visit:b.visit,etag:'"'+(++sequence)+'"'});
    await r.fulfill({json:{ok:true,accepted:true}});return;
   }
   reads++;
   if(readMode==='denied'){await r.fulfill({status:403,json:{image:null}});return;}
   if(readMode==='error'){await r.fulfill({status:503,json:{image:null}});return;}
   if(readMode==='pending'){await r.fulfill({json:{image:null,pending:true}});return;}
   if(readMode==='broken'){await r.fulfill({json:{image:'data:image/jpeg;base64,broken'}});return;}
   const url=new URL(r.request().url()),f=frames.get(url.searchParams.get('player')!);
   if(!f||f.visit!==url.searchParams.get('visit')){await r.fulfill({json:{image:baselines.get(url.searchParams.get('player')!)??null,cached:true}});return;}
   if(r.request().headers()['if-none-match']===f.etag){await r.fulfill({status:304,headers:{etag:f.etag},body:''});return;}
   await r.fulfill({json:{image:f.image},headers:{etag:f.etag}});
  });
 }
 const camera=(p:Page)=>p.locator('[data-camera-image]');
 const see=async(image:string)=>{for(const p of [page,state.pB,state.pS]){const toggle=p.getByRole('button',{name:'Dartscheibe anzeigen',exact:true});if(await toggle.isVisible())await toggle.click();await expect(camera(p)).toHaveAttribute('href',image);await expect(p.locator('.board-area')).toBeVisible();}};
 const noCamera=async()=>{for(const p of [page,state.pB,state.pS])await expect(camera(p)).toHaveCount(0);};
 try{
  await connectAutodarts(page,'board-a',sockets,true);await see(pictures[0]);
  for(const mode of ['error','pending','broken']){readMode=mode;const before=reads;await expect.poll(()=>reads).toBeGreaterThan(before+3);await see(pictures[0]);}
  readMode='denied';await noCamera();readMode='normal';await see(pictures[0]);
  const box=await page.locator('.dartboard').boundingBox();await page.locator('.dartboard').click({position:{x:box!.width/2,y:box!.height/2-103*box!.width/440}});
  await expect(page.locator('[data-player-score="0"]')).toHaveText('241');await expect(state.pB.locator('[data-marker="1"] circle')).toHaveCount(1);
  await page.screenshot({path:'test-results/'+info.project.name+'-shared-camera.png',fullPage:true});
  await confirmVisit(page);await expect(state.pB.locator('.player-1')).toHaveClass(/at-oche/);await noCamera();
  if(await state.pB.getByRole('button',{name:'Mit Zahlentastatur eingeben',exact:true}).isVisible())await state.pB.getByRole('button',{name:'Mit Zahlentastatur eingeben',exact:true}).click();
  await state.pB.getByRole('button',{name:'Miss',exact:true}).click();await state.pB.locator('.player-1').getByRole('button',{name:'Weiter'}).click();await see(pictures[0]);
  // The official image channel updates the current frame without importing another dart.
  sockets.get('board-a')!.send(JSON.stringify({channel:'autodarts.boards.images',topic:'board-a.live?cam=0&warp=true',data:{url:'/image/board-b.jpg'}}));await see(pictures[1]);
  await connectAutodarts(state.pB,'board-b',sockets,true);
  if(await page.getByRole('button',{name:'Mit Zahlentastatur eingeben'}).isVisible())await page.getByRole('button',{name:'Mit Zahlentastatur eingeben'}).click();
  await page.getByRole('button',{name:'Miss',exact:true}).click();await confirmVisit(page);await expect(state.pB.locator('.player-1')).toHaveClass(/at-oche/);await see(pictures[1]);
  await state.pB.getByRole('button',{name:'Match-Einstellungen',exact:true}).click();await state.pB.getByRole('checkbox',{name:'Kamerabild für beide Spieler',exact:true}).uncheck();await state.pB.getByRole('button',{name:'Einstellungen schließen',exact:true}).click();await noCamera();
 }finally{await state.close();}
});


test('gemeinsames Gerät bedient beide Matchseiten und Tastatur bleibt ohne Kamera kompakt',async({page,browser},info)=>{
 const state=await room(browser,page,2,'double',false,false,true);
 try{
  await page.getByRole('button',{name:'Beide Spieler an diesem Gerät',exact:true}).click();
  await dart(page,20,3);await confirmVisit(page);await expect(page.locator('.player-1')).toHaveClass(/at-oche/);
  if(info.project.name==='desktop')await page.getByRole('button',{name:'Mit Zahlentastatur eingeben'}).click();await page.getByRole('button',{name:'Miss',exact:true}).click();await page.locator('.player-1').getByRole('button',{name:'Weiter'}).click();await expect(page.locator('.player-0')).toHaveClass(/at-oche/);
  await page.getByRole('button',{name:'Match-Einstellungen',exact:true}).click();await page.getByRole('checkbox',{name:'Dark Mode',exact:true}).check();await page.getByRole('button',{name:'Einstellungen schließen',exact:true}).click();
  expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');
  await expect(page.locator('.board-area')).toBeHidden();
  if(info.project.name==='mobile'){await page.setViewportSize({width:390,height:667});await page.screenshot({path:'test-results/mobile-compact-dark.png',fullPage:true});const size=await page.evaluate(()=>({height:innerHeight,scroll:document.documentElement.scrollHeight}));expect(size.scroll).toBeLessThanOrEqual(size.height+2);}
  await page.screenshot({path:'test-results/'+info.project.name+'-compact-dark.png',fullPage:true});
 }finally{await state.close();}
});
test('gespeicherte Scheibe verbindet sich beim nächsten Match-Aufruf automatisch',async({page,browser})=>{
 const state=await room(browser,page,2),sockets=new Map<string,WebSocketRoute>();
 try{await connectAutodarts(page,'board-a',sockets);const old=sockets.get('board-a');await page.reload();await expect.poll(()=>sockets.get('board-a')!==old).toBe(true);await expect(page.locator('.autodarts-heading')).toContainText('Board-Daten empfangen');}finally{await state.close();}
});

test('zufälliger Walk-on startet schon beim Ausbullen automatisch und nur einmal',async({page,browser})=>{
 await page.addInitScript(()=>{(window as unknown as {musicLog:string[]}).musicLog=[];HTMLMediaElement.prototype.play=function(){if(this.getAttribute('data-audio-channel')==='music')(window as unknown as {musicLog:string[]}).musicLog.push(this.getAttribute('src')??'');return Promise.resolve();};HTMLMediaElement.prototype.pause=function(){};});
 const state=await room(browser,page,2,'double',false,true);
 try{await expect.poll(()=>page.evaluate(()=>(window as unknown as {musicLog:string[]}).musicLog.length)).toBe(1);await expect(page.locator('.game-heading')).toHaveText('Wer beginnt?');await page.waitForTimeout(800);expect(await page.evaluate(()=>(window as unknown as {musicLog:string[]}).musicLog[0])).toContain('/audio/walk-on/');expect(await page.evaluate(()=>(window as unknown as {musicLog:string[]}).musicLog.length)).toBe(1);}finally{await state.close();}
});

test('neues Matchlayout nutzt Handy, 16:9 und breite Bildschirme ohne verdeckte Werkzeuge',async({page,browser},info)=>{
 test.skip(info.project.name!=='desktop');const state=await room(browser,page,2);const sizes=[{width:1366,height:768},{width:1920,height:1080},{width:2560,height:1080},{width:3440,height:1440},{width:390,height:844},{width:390,height:667}];const fonts:number[]=[];
 try{for(const size of sizes){await page.setViewportSize(size);if(size.width<=760&&await page.getByRole('button',{name:'Mit Zahlentastatur eingeben',exact:true}).isVisible())await page.getByRole('button',{name:'Mit Zahlentastatur eingeben',exact:true}).click();
 await expect(page.getByRole('button',{name:'Match-Einstellungen',exact:true})).toBeVisible();const layout=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,font:parseFloat(getComputedStyle(document.querySelector('.remaining-score')!).fontSize),toolbar:document.querySelector('.match-toolbar')!.getBoundingClientRect().bottom,settings:document.querySelector('.game-settings-trigger')!.getBoundingClientRect().bottom}));fonts.push(layout.font);expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);expect(layout.scroll).toBeLessThanOrEqual(layout.height+2);expect(layout.settings).toBeLessThanOrEqual(layout.toolbar+2);await page.screenshot({path:'test-results/redesign/match-'+size.width+'x'+size.height+'.png',fullPage:true});}
 expect(fonts[3]).toBeGreaterThan(fonts[0]*1.5);
 }finally{await state.close();}
});


test('Treffersounds starten vor der Ansage ohne den Caller aufzuhalten und lassen sich abschalten',async({page,browser})=>{
 await page.addInitScript(()=>{(window as unknown as {fxLog:string[]}).fxLog=[];HTMLMediaElement.prototype.play=function(){const source=this.getAttribute('src')??'';(window as unknown as {fxLog:string[]}).fxLog.push((this.dataset.audioChannel??'')+':'+source);if(this.dataset.audioChannel==='caller')setTimeout(()=>this.dispatchEvent(new Event('ended')),10);return Promise.resolve();};HTMLMediaElement.prototype.pause=function(){};});
 const state=await room(browser,page,2);const log=()=>page.evaluate(()=>(window as unknown as {fxLog:string[]}).fxLog.filter(s=>s.includes('/effects/')||s.includes('/caller/')));
 try{await dart(page,20,3);await dart(page,20,3);await dart(page,20,3);await expect.poll(async()=>(await log()).filter(s=>s==='effects:/audio/effects/triple-high.wav').length).toBe(3);await confirmVisit(page);expect((await log()).filter(s=>s==='effects:/audio/effects/triple-high.wav')).toHaveLength(3);await page.getByRole('button',{name:'Match-Einstellungen',exact:true}).click();await page.getByRole('checkbox',{name:'Treffer- und Siegessounds',exact:true}).uncheck();await page.getByRole('slider',{name:'Soundeffekte Lautstärke'}).press('Home');for(let i=0;i<7;i++)await page.getByRole('slider',{name:'Soundeffekte Lautstärke'}).press('ArrowRight');await page.reload();await page.getByRole('button',{name:'Match-Einstellungen',exact:true}).click();await expect(page.getByRole('checkbox',{name:'Treffer- und Siegessounds',exact:true})).not.toBeChecked();await expect(page.getByRole('slider',{name:'Soundeffekte Lautstärke'})).toHaveValue('0.35');}finally{await state.close();}
});
test('Sieg zeigt Lichtkranz auf allen Geräten und spielt einen kurzen eigenen Kanal',async({page,browser},info)=>{
 await page.addInitScript(()=>{(window as unknown as {victoryLog:string[]}).victoryLog=[];HTMLMediaElement.prototype.play=function(){if(this.dataset.audioChannel==='victory')(window as unknown as {victoryLog:string[]}).victoryLog.push(this.getAttribute('src')??'');return Promise.resolve();};HTMLMediaElement.prototype.pause=function(){};});
 const state=await room(browser,page,1,'double',true);for(const p of [page,state.pB,state.pS])await p.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
 try{await dart(page,10,2);for(const p of [page,state.pB,state.pS]){await expect(p.locator('.match-celebration')).toBeVisible();await expect(p.locator('.player-0')).toHaveClass(/match-victory/);await expect(p.locator('.player-0 .victory-halo')).toBeVisible();}expect(await page.evaluate(()=>(window as unknown as {victoryLog:string[]}).victoryLog.filter(s=>s.includes('match-win')).length)).toBe(1);await page.screenshot({path:'test-results/'+info.project.name+'-match-victory.png'});await confirmVisit(page);for(const p of [page,state.pB,state.pS])await p.clock.fastForward(25500);await expect(page).toHaveURL(new RegExp('/tournaments/'+state.t.id+'$'),{timeout:9000});}finally{await state.close();}
});
test('alle neuen Sounddateien werden als echtes Audio dekodiert',async({page})=>{
 await page.goto('/login');const durations=await page.evaluate(async()=>{const context=new AudioContext();try{return await Promise.all(['triple-low.wav','triple-mid.mp3','triple-high.wav','bull.mp3','single-bull.wav','double.wav','leg-win.wav','match-win.mp3'].map(async file=>{const response=await fetch('/audio/effects/'+file);if(!response.ok)throw Error(file);const buffer=await context.decodeAudioData(await response.arrayBuffer());return {file,duration:buffer.duration};}));}finally{await context.close();}});for(const sound of durations)expect(sound.duration).toBeGreaterThan(.1);console.log('Sound durations',durations);
});

test('große Leg-Feier bleibt zehn Sekunden und bestätigt den Checkout automatisch',async({page,browser},info)=>{
 await page.addInitScript(()=>{HTMLMediaElement.prototype.play=function(){return Promise.resolve();};HTMLMediaElement.prototype.pause=function(){};});
 const state=await room(browser,page,2,'double',true);for(const p of [page,state.pB,state.pS])await p.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
 try{await dart(page,10,2);await expect(page.locator('.small-leg-celebration')).toBeVisible();for(const p of [page,state.pB,state.pS])await expect(p.locator('.small-leg-celebration')).toBeVisible();const box=await page.locator('.celebration-card').boundingBox();expect(box!.width).toBeGreaterThan(page.viewportSize()!.width*.9);expect(box!.height).toBeGreaterThan(page.viewportSize()!.height*.85);await page.screenshot({path:'test-results/'+info.project.name+'-large-leg-victory.png'});await page.clock.fastForward(9000);await expect(page.locator('.small-leg-celebration')).toBeVisible();expect(state.g.current).toHaveLength(3);await page.clock.fastForward(1100);await expect(page.locator('.small-leg-celebration')).toHaveCount(0);await expect.poll(()=>gameView(state.g).legs[0]).toBe(1);await expect(page.locator('.player-1')).toHaveClass(/at-oche/);}finally{await state.close();}
});
test('große Match-Feier bleibt 25 Sekunden und beendet das Spiel automatisch',async({page,browser},info)=>{
 await page.addInitScript(()=>{HTMLMediaElement.prototype.play=function(){return Promise.resolve();};HTMLMediaElement.prototype.pause=function(){};});
 const state=await room(browser,page,1,'double',true);for(const p of [page,state.pB,state.pS])await p.clock.install();await page.clock.pauseAt(await page.evaluate(()=>Date.now()+1000));
 try{await dart(page,10,2);for(const p of [page,state.pB,state.pS])await expect(p.locator('.match-celebration')).toBeVisible();const box=await page.locator('.celebration-card').boundingBox();expect(box!.width).toBeGreaterThan(page.viewportSize()!.width*.9);expect(box!.height).toBeGreaterThan(page.viewportSize()!.height*.85);await page.screenshot({path:'test-results/'+info.project.name+'-large-match-victory.png'});await page.clock.fastForward(24000);await expect(page.locator('.match-celebration')).toBeVisible();expect(state.g.phase).toBe('playing');await page.clock.fastForward(1100);await expect.poll(()=>state.g.phase).toBe('finished');for(const p of [state.pB,state.pS])await p.clock.fastForward(25100);for(const p of [page,state.pB,state.pS])await expect(p).toHaveURL(new RegExp('/tournaments/'+state.t.id+'$'));}finally{await state.close();}
});

test('Siegesanzeige zeigt keine Erklärungstexte und das Kreuz beendet Anzeige und Ton',async({page,browser})=>{
 await page.addInitScript(()=>{(window as unknown as {stops:number}).stops=0;HTMLMediaElement.prototype.play=function(){return Promise.resolve();};HTMLMediaElement.prototype.pause=function(){if(this.dataset.audioChannel==='victory')(window as unknown as {stops:number}).stops++;};});
 const state=await room(browser,page,2,'double',true);
 try{await dart(page,10,2);const overlay=page.locator('.leg-celebration');await expect(overlay).toBeVisible();await expect(overlay).not.toContainText(/Sekunden|Danach|Champion am Oche|Starker Checkout/);const stops=await page.evaluate(()=>(window as unknown as {stops:number}).stops);await page.getByRole('button',{name:'Siegesanzeige schließen',exact:true}).click();await expect(overlay).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>(window as unknown as {stops:number}).stops)).toBeGreaterThan(stops);await expect.poll(()=>gameView(state.g).legs[0]).toBe(1);await expect(page.locator('.player-1')).toHaveClass(/at-oche/);await expect(page.locator('.victory-halo')).toHaveCount(0);await expect(state.pB.locator('.leg-celebration')).toBeVisible();}finally{await state.close();}
});
test('Kreuz beim Match-Sieg bestätigt und führt sofort zurück zum Bracket',async({page,browser})=>{
 await page.addInitScript(()=>{HTMLMediaElement.prototype.play=function(){return Promise.resolve();};HTMLMediaElement.prototype.pause=function(){};});const state=await room(browser,page,1,'double',true);
 try{await dart(page,10,2);await expect(page.locator('.match-celebration')).toBeVisible();await page.getByRole('button',{name:'Siegesanzeige schließen',exact:true}).click();await expect(page).toHaveURL(new RegExp('/tournaments/'+state.t.id+'$'));expect(state.g.phase).toBe('finished');}finally{await state.close();}
});


test('Next Leg directly confirms a checkout and dismisses the victory overlay in English',async({page,browser})=>{
 await page.addInitScript(()=>localStorage.setItem('dartbracket-language','en'));
 const state=await room(browser,page,2,'double',true);try{
  await dart(page,10,2);await page.getByRole('button',{name:'Next Leg',exact:true}).click();await expect(page.locator('.leg-celebration')).toHaveCount(0);await expect.poll(()=>gameView(state.g).legs[0]).toBe(1);
 }finally{await state.close();}
});

test('additional accounts share one Autodarts connection through both bull confirmations and turns',async({page,browser})=>{
 const state=await room(browser,page,2,'double',false,true,'accounts'),sockets=new Map<string,WebSocketRoute>();
 const hit=(x:number,y:number)=>sockets.get('shared-board')!.send(JSON.stringify({channel:'autodarts.boards',topic:'shared-board.events',data:{boardId:'shared-board',event:'Throw detected',throwNumber:1,throw:{coords:{x,y},segment:{number:20,multiplier:1}}}}));
 const empty=()=>sockets.get('shared-board')!.send(JSON.stringify({channel:'autodarts.boards',topic:'shared-board.events',data:{boardId:'shared-board',event:'Takeout finished'}}));
 try{
  await expect(page.getByRole('dialog',{name:'Spieler für dieses Match'})).toHaveCount(0);
  await connectAutodarts(page,'shared-board',sockets,false,true);hit(.02,.12);await expect(page.locator('.player-0 .bull-result strong')).toHaveText('20.7 mm');
  empty();await expect(page.locator('.player-0 .bull-result')).toContainText('Bestätigt');hit(.04,.2);await expect(page.locator('.player-1 .bull-result strong')).toHaveText('34.7 mm');
  empty();await expect(page.locator('.player-0')).toHaveClass(/at-oche/);hit(.08,.4);await expect(page.locator('[data-player-score="0"]')).toHaveText('281');
  empty();await expect(page.locator('.player-1')).toHaveClass(/at-oche/);hit(.08,.4);await expect(page.locator('[data-player-score="1"]')).toHaveText('281');
  expect(sockets.size).toBe(1);
 }finally{await state.close();}
});

async function autoplayGate(page:Page){
 await page.addInitScript(()=>{
  const state={allowed:false,played:[] as {channel:string;src:string;allowed:boolean}[]};(window as any).audioGate=state;
  for(const name of ['pointerdown','keydown'])document.addEventListener(name,()=>{state.allowed=true;},true);
  HTMLMediaElement.prototype.play=function(){const src=this.getAttribute('src')??'',channel=this.dataset.audioChannel??'';state.played.push({src,channel,allowed:state.allowed});if(!state.allowed)return Promise.reject(new DOMException('User gesture required','NotAllowedError'));if(channel==='caller')setTimeout(()=>{if(this.getAttribute('src')===src)this.dispatchEvent(new Event('ended'));},20);return Promise.resolve();};HTMLMediaElement.prototype.pause=function(){};
 });
}
test('blocked initial walk-on resumes on a keyboard gesture without toggling audio',async({page,browser})=>{
 await autoplayGate(page);const state=await room(browser,page,2,'double',false,true,'accounts');
 try{
  await expect.poll(()=>page.evaluate(()=>(window as any).audioGate.played.some((p:any)=>p.channel==='music'&&p.src.includes('/walk-on/')&&!p.allowed))).toBe(true);
  await expect(page.locator('.game-audio').getByRole('button',{name:'Walk-on stoppen',exact:true,includeHidden:true})).toHaveCount(0);
  await page.keyboard.press('Shift');
  await expect.poll(()=>page.evaluate(()=>(window as any).audioGate.played.some((p:any)=>p.channel==='music'&&p.src.includes('/walk-on/')&&p.allowed))).toBe(true);
  await expect(page.locator('.game-audio').getByRole('button',{name:'Walk-on stoppen',exact:true,includeHidden:true})).toHaveCount(1);
  await expect(page.locator('.game-audio').getByRole('button',{name:'Caller ausschalten',exact:true,includeHidden:true})).toHaveCount(1);
 }finally{await state.close();}
});
test('initial caller retries blocked audio on the first click and continues with scoring',async({page,browser})=>{
  test.skip(process.env.NEXT_PUBLIC_CALLER_PACK_ENABLED!=='true','Requires a separately installed licensed caller pack');
 await autoplayGate(page);const state=await room(browser,page,2);
 try{
  await expect.poll(()=>page.evaluate(()=>(window as any).audioGate.played.some((p:any)=>p.channel==='caller'&&p.src.includes('gameon.wav')&&!p.allowed))).toBe(true);
  // A normal match action supplies the gesture; no audio setting is changed.
  await dart(page,20,3);await dart(page,20,3);await dart(page,20,3);
  await expect.poll(()=>page.evaluate(()=>(window as any).audioGate.played.filter((p:any)=>p.channel==='caller'&&p.allowed&&p.src.includes('/caller/')).map((p:any)=>p.src))).toEqual(['/audio/caller/gameon.wav','/audio/caller/180.wav']);
 }finally{await state.close();}
});
test('board size and position stay fixed from an empty visit through confirmation and correction',async({page,browser})=>{
 const state=await room(browser,page,2);try{
  if((page.viewportSize()?.width??1000)<=760)await page.getByRole('button',{name:'Dartscheibe anzeigen',exact:true}).click();
  const board=page.locator('.dartboard'),before=await board.boundingBox();expect(before).not.toBeNull();
  // Use board input on both desktop and mobile, keeping the same input mode.
  for(const field of ['T20','T19','T18'])await page.locator('.dartboard [data-field="'+field+'"]').last().click();
  await expect(page.locator('.checkout-line')).toContainText('Aufnahme bestätigen oder Dart korrigieren');
  for(const stateName of ['confirmation','correction']){
   if(stateName==='correction')await page.locator('.player-0 .visit-darts button').first().click();
   const after=await board.boundingBox();for(const key of ['x','y','width','height'] as const)expect(Math.abs(after![key]-before![key])).toBeLessThanOrEqual(1);
  }
 }finally{await state.close();}
});

test('Safari-style click-only activation starts the pending walk-on without toggling',async({page,browser})=>{
 await page.addInitScript(()=>{
  const gate={active:false,played:[] as {src:string;allowed:boolean}[]};(window as any).safariAudioGate=gate;
  for(const event of ['pointerdown','pointerup','touchend','click'])document.addEventListener(event,()=>{gate.active=event==='click'||event==='touchend';setTimeout(()=>{gate.active=false;},0);},true);
  HTMLMediaElement.prototype.play=function(){const src=this.getAttribute('src')??'';if(this.dataset.audioChannel==='music')gate.played.push({src,allowed:gate.active});if(!gate.active)return Promise.reject(new DOMException('Tap must finish first','NotAllowedError'));Object.defineProperty(this,'paused',{value:false,configurable:true});return Promise.resolve();};HTMLMediaElement.prototype.pause=function(){Object.defineProperty(this,'paused',{value:true,configurable:true});};
 });
 const state=await room(browser,page,2,'double',false,true,'accounts');try{
  await expect.poll(()=>page.evaluate(()=>(window as any).safariAudioGate.played.some((p:any)=>p.src.includes('/walk-on/')&&!p.allowed))).toBe(true);
  // Just opening settings is an ordinary tap, not an audio toggle.
  await page.getByRole('button',{name:'Match-Einstellungen',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).safariAudioGate.played.some((p:any)=>p.src.includes('/walk-on/')&&p.allowed))).toBe(true);
  await expect(page.getByRole('button',{name:'Walk-on stoppen',exact:true})).toBeVisible();
  const checkbox=page.getByRole('checkbox',{name:'Walk-on beim Ausbullen automatisch starten',exact:true});
  await checkbox.uncheck();await expect(page.getByRole('button',{name:'Walk-on starten',exact:true})).toBeVisible();
  const before=await page.evaluate(()=>(window as any).safariAudioGate.played.filter((p:any)=>p.src.includes('/walk-on/')&&p.allowed).length);
  await checkbox.check();await expect(page.getByRole('button',{name:'Walk-on stoppen',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).safariAudioGate.played.filter((p:any)=>p.src.includes('/walk-on/')&&p.allowed).length)).toBeGreaterThan(before);
  await page.locator('audio[data-audio-channel="music"]').evaluate(audio=>{(audio as HTMLAudioElement).pause();audio.dispatchEvent(new Event('pause'));});
  await page.getByRole('button',{name:'Walk-on starten',exact:true}).click();await expect(page.getByRole('button',{name:'Walk-on stoppen',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Walk-on stoppen',exact:true}).click();await expect(page.getByRole('button',{name:'Walk-on starten',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Einstellungen schließen',exact:true}).click();
  const stopped=await page.evaluate(()=>(window as any).safariAudioGate.played.filter((p:any)=>p.src.includes('/walk-on/')&&p.allowed).length);
  await page.getByRole('button',{name:'Match-Einstellungen',exact:true}).click();await expect(page.getByRole('button',{name:'Walk-on starten',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).safariAudioGate.played.filter((p:any)=>p.src.includes('/walk-on/')&&p.allowed).length)).toBe(stopped);
 }finally{await state.close();}
});
test('false off-turn miss does not block the next two actual Autodarts hits',async({page,browser})=>{
 const state=await room(browser,page);const sockets=new Map<string,WebSocketRoute>();try{
  await connectAutodarts(state.pB,'board-b',sockets);const shot=(n:number,number:number)=>sockets.get('board-b')!.send(JSON.stringify({channel:'autodarts.boards',topic:'board-b.events',data:{event:'Throw detected',throwNumber:n,throw:{segment:{number,multiplier:number?1:0}}}}));shot(1,0);await expect(state.pB.locator('.autodarts-heading')).toContainText('Aktuell keine Eingabe für dich');await dart(page,1,1);await confirmVisit(page);await expect(state.pB.locator('.player-1')).toHaveClass(/at-oche/);shot(2,20);await expect.poll(()=>state.g.current.map(h=>h.number)).toEqual([20]);shot(3,19);await expect.poll(()=>state.g.current.map(h=>h.number)).toEqual([20,19]);await expect(state.pB.getByRole('button',{name:'Automatische Eingabe ausschalten',exact:true,includeHidden:true})).toHaveCount(1);shot(3,19);expect(state.g.current).toHaveLength(2);
 }finally{await state.close();}
});
test('X01 reconnect recovers takeout missed during a socket outage exactly once',async({page,browser})=>{
 const state=await room(browser,page);const sockets=new Map<string,WebSocketRoute>();try{await connectAutodarts(page,'recover',sockets,false,true);const first=sockets.get('recover')!;for(let i=1;i<=3;i++){first.send(JSON.stringify({channel:'autodarts.boards',topic:'recover.events',data:{event:'Throw detected',throwNumber:i,throw:{segment:{number:0,multiplier:0}}}}));await expect.poll(()=>state.g.current.length).toBe(i);}first.close({code:1001});await expect.poll(()=>sockets.get('recover')!==first).toBe(true);await expect.poll(()=>state.g.turns.length).toBe(1);expect(state.g.current).toHaveLength(0);sockets.get('recover')!.send(JSON.stringify({channel:'autodarts.boards',topic:'recover.events',data:{event:'Takeout finished'}}));await expect.poll(()=>state.g.turns.length).toBe(1);
 }finally{await state.close();}
});

test('public build keeps an absent caller pack disabled and makes no recording requests',async({page,browser})=>{
 test.skip(process.env.NEXT_PUBLIC_CALLER_PACK_ENABLED==='true','Public default only');
 const requests:string[]=[];page.on('request',r=>{if(r.url().includes('/audio/caller/'))requests.push(r.url());});
 await page.addInitScript(()=>{HTMLMediaElement.prototype.play=function(){return Promise.resolve();};HTMLMediaElement.prototype.pause=function(){};});
 const state=await room(browser,page,2);
 try{
  await page.getByRole('button',{name:'Match-Einstellungen',exact:true}).click();
  await expect(page.getByText('Caller-Paket nicht installiert',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Caller ausschalten',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');await dart(page,20,3);await dart(page,20,3);await dart(page,20,3);
  expect(requests).toEqual([]);
 }finally{await state.close();}
});
