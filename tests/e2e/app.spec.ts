import { test, expect, type Page } from '@playwright/test';
import { randomInt, randomUUID } from 'node:crypto';
import { createTournament, updateMatch, type Tournament, type Role } from '../../src/domain/tournament';

async function fixture(page:Page,role:Role|null='owner',mode:Tournament['mode']='knockout',live=false) {
  await page.route('**/api/identity',r=>r.fulfill({json:{signedIn:role!==null,role:'owner'}}));
  await page.route('**/api/players?**',r=>r.fulfill({json:{players:[]}}));await page.route('**/api/invitations',r=>r.fulfill({json:{url:'https://example.test/join?code=ABCD1234'}}));await page.route('**/api/watch',r=>r.fulfill({json:{url:'https://example.test/watch/'+'x'.repeat(43)}}));

  let t=createTournament({id:randomUUID(),name:'Freitag am Oche',names:['Jonas','Alex','Sam','Mika','Lea','Chris','Nico','Robin'],mode,groupSize:4,advancePerGroup:2},randomInt,randomUUID);
  t.status='running';t.startedAt=new Date().toISOString();
  let activeRole=role,runningGame=live,resets=0;
  await page.route('**/api/game?**',r=>r.fulfill({json:{game:runningGame?{version:7}:null}}));
  await page.route('**/api/game',async r=>{const body=r.request().postDataJSON();if(body.operation!=='reset'||!body.confirmed||activeRole!=='owner'){await r.fulfill({status:403,json:{error:'Keine Berechtigung'}});return;}resets++;runningGame=false;t=updateMatch(t,t.matches[0].id,{legs:[null,null],status:'pending',forfeited:null}).tournament;t.version++;await r.fulfill({json:{ok:true,reset:true}});});
  await page.route('**/api/app**',async route=>{
    if(route.request().method()==='GET') {
      if(route.request().url().includes('access=1')) {await route.fulfill({json:{access:{url:'https://example.com/login',pin:'012345',enabled:true}}});return;}
      await route.fulfill({json:{setup:false,tournaments:[t],activeGames:runningGame?[`${t.id}:${t.matches[0].id}`]:[],liveId:t.id,appOrigin:'http://localhost:3000',editorTournamentId:t.id,session:activeRole?{role:activeRole,tournamentId:activeRole==='owner'?null:t.id,participantId:activeRole==='editor'?t.matches[0].players[0]:null}:null}});return;
    }
    const body=route.request().postDataJSON();
    if(body.action==='login'){if(body.payload.password!=='012345'){await route.fulfill({status:401,json:{error:'Zugangsdaten ungültig oder Zugang deaktiviert.'}});return;}activeRole='editor';await route.fulfill({json:{ok:true,tournamentId:t.id,redirect:`/tournaments/${t.id}`}});return;}
    if(body.action==='score'){
      if(body.expectedVersion!==t.version){await route.fulfill({status:409,json:{error:'Das Turnier wurde inzwischen geändert.',conflict:true}});return;}
      t=updateMatch(t,body.payload.matchId,body.payload.result).tournament;t.version++;await route.fulfill({json:{ok:true,tournament:t}});return;
    }
    await route.fulfill({json:{ok:true}});
  });
  await page.route('**/api/watch?**',r=>r.fulfill({json:{tournament:t,games:[]}}));
  await page.route('**/*.supabase.co/**',r=>r.abort());
  return {get t(){return t;},get resets(){return resets;},advance:()=>{t.version++;},score:()=>{const m=t.matches.find(m=>!m.automatic&&m.players.every(Boolean))!;t=updateMatch(t,m.id,{legs:[3,1],status:'finished',forfeited:null}).tournament;t.version++;}};
}

test('Owner sieht Übersicht und erstellt Formular',async({page},testInfo)=>{
  await fixture(page);await page.goto('/');await expect(page.getByRole('heading',{name:'Turniere'})).toBeVisible();
  await page.screenshot({path:`test-results/${testInfo.project.name}-overview.png`,fullPage:true});
  await page.getByRole('button',{name:'Neues Turnier'}).click();await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Turniername',{exact:true}).fill('Testspieltag');
  await expect(page.getByRole('combobox',{name:/Spieler hinzufügen/})).toBeVisible();await expect(page.getByRole('button',{name:'Lobby erstellen'})).toBeEnabled();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('Score-Editor kann Matches bearbeiten und sieht keine Verwaltung',async({page})=>{
  const state=await fixture(page,'editor');await page.goto(`/tournaments/${state.t.id}`);
  await expect(page.getByRole('heading',{name:'Freitag am Oche',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Einstellungen'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Zuschauerlink'})).toHaveCount(0);
  const m=state.t.matches[0];await page.getByRole('button',{name:new RegExp(`${state.t.participants.find(p=>p.id===m.players[0])!.name} gegen`)}).first().click();
  await page.getByLabel(`Legs ${state.t.participants.find(p=>p.id===m.players[0])!.name}`,{exact:true}).fill('3');await page.getByLabel(`Legs ${state.t.participants.find(p=>p.id===m.players[1])!.name}`,{exact:true}).fill('1');
  await page.getByRole('combobox',{name:'Spielstatus'}).selectOption('finished');await page.getByRole('button',{name:'Ergebnis speichern'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.t.matches[0].winner).toBe(m.players[0]);
});
test('Zuschauer im gemeinsamen Turniertab besitzen keine Bearbeitungsbuttons',async({page},testInfo)=>{
  const state=await fixture(page,null);await page.goto('/watch/'+'x'.repeat(43));await expect(page.locator('.bracket')).toBeVisible();
  await expect(page.getByRole('button',{name:'Einstellungen'})).toHaveCount(0);await expect(page.locator('button.match-card:not([disabled])')).toHaveCount(0);
  await expect(page.locator('.bracket-connectors path')).toHaveCount(6);
  for(const match of state.t.matches)for(const source of match.sources)if(source.kind==='winner')await expect(page.locator(`.bracket-connectors path[data-source-match="${source.id}"][data-target-match="${match.id}"]`)).toHaveCount(1);
  await page.screenshot({path:`test-results/${testInfo.project.name}-bracket-desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});await expect(page.locator('body')).toHaveJSProperty('scrollWidth',390);
  await page.screenshot({path:`test-results/${testInfo.project.name}-bracket.png`,fullPage:true});
  expect(state.t.matches.length).toBe(7);
});
test('Gruppentabelle und Paarungen werden angezeigt',async({page})=>{
  const state=await fixture(page,null,'groups');await page.goto('/watch/'+'x'.repeat(43));await expect(page.getByRole('heading',{name:'Gruppe A',exact:true})).toBeVisible();await expect(page.getByRole('table')).toHaveCount(2);
  await expect(page.locator('.bracket .match-card')).toHaveCount(0);
});
test('Konflikt erhält Eingabe und verhindert unbemerktes Überschreiben',async({page})=>{
  const state=await fixture(page,'editor');await page.goto(`/tournaments/${state.t.id}`);await page.locator('.match-card:not([disabled])').first().click();
  await page.locator('.counter input').nth(0).fill('3');await page.locator('.counter input').nth(1).fill('1');state.advance();await page.getByRole('button',{name:'Ergebnis speichern'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();await expect(page.locator('.counter input').first()).toHaveValue('3');await expect(page.getByRole('button',{name:'Ergebnis speichern'})).toBeDisabled();
});
test('Zuschauer erhält geänderte Ergebnisse beim automatischen Neuabgleich ohne Neuladen',async({page})=>{
  await page.clock.install();const state=await fixture(page,null);await page.goto('/watch/'+'x'.repeat(43));
  await expect(page.locator('.match-card').first()).not.toHaveClass(/finished/);state.score();
  await page.clock.fastForward(2600);await expect(page.locator('.match-card').first()).toHaveClass(/finished/);await expect(page.locator('.match-card').first().locator('.match-player strong')).toHaveText(['3','1']);
});

test('zentrale Geräteeinstellungen und kompakte Turnierverwaltung',async({page})=>{
 const state=await fixture(page);await page.goto('/settings');await expect(page.getByRole('heading',{name:'Meine Einstellungen',exact:true})).toBeVisible();await page.getByRole('checkbox',{name:'Dark Mode',exact:true}).check();await page.getByRole('checkbox',{name:'Walk-on beim Ausbullen automatisch starten'}).uncheck();await expect(page.getByRole('checkbox',{name:'Auf der Dartscheibe eingeben (auch auf dem Handy)'})).toHaveCount(0);await page.reload();await expect(page.getByRole('checkbox',{name:'Dark Mode',exact:true})).toBeChecked();await expect(page.getByRole('checkbox',{name:'Walk-on beim Ausbullen automatisch starten'})).not.toBeChecked();await expect(page.getByRole('checkbox',{name:'Auf der Dartscheibe eingeben (auch auf dem Handy)'})).toHaveCount(0);
 await page.goto('/tournaments/'+state.t.id);await expect(page.locator('.progress-panel')).toHaveCount(0);await expect(page.getByRole('button',{name:'Archivieren',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Einstellungen',exact:true}).click();await expect(page.getByRole('button',{name:'Archivieren',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Änderungshistorie',exact:true})).toBeVisible();
});

test('neues Farbsystem bleibt auf allen Seiten dunkel und reagiert auf Größenwechsel',async({page},info)=>{
 test.setTimeout(120000);
 test.skip(info.project.name!=='desktop');const state=await fixture(page);await page.route('**/api/autodarts',r=>r.fulfill({json:{authenticated:false}}));
 for(const size of [{width:1920,height:1080},{width:2560,height:1080},{width:390,height:844}]){await page.setViewportSize(size);for(const path of ['/','/admin','/live','/tournaments/'+state.t.id,'/settings']){await page.goto(path);await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.locator('h1,h2').first()).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);await page.screenshot({path:'test-results/redesign/'+path.replaceAll('/','_')+'-'+size.width+'.png',fullPage:true});}}
 await page.goto('/tournaments/'+state.t.id);for(let i=0;i<20;i++)await page.setViewportSize({width:1000+i*40,height:800});await page.waitForTimeout(120);await expect(page.locator('.bracket-connectors path')).toHaveCount(6);await expect(page.locator('body')).toHaveJSProperty('scrollWidth',1760);
});

test('Anmeldung, Gruppen und Dialoge benutzen kontrastreiche dunkle Flächen',async({page},info)=>{
 test.skip(info.project.name!=='desktop');const state=await fixture(page);await page.route('**/api/autodarts',r=>r.fulfill({json:{authenticated:false}}));for(const size of [{width:1920,height:1080},{width:390,height:844}]){await page.setViewportSize(size);await page.goto('/tournaments/'+state.t.id);for(const label of ['Einstellungen','Zuschauerlink']){await page.getByRole('button',{name:label,exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();const colors=await page.getByRole('dialog').evaluate(e=>({background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color}));expect(colors.background).toBe('rgb(17, 27, 50)');await page.screenshot({path:'test-results/redesign/dialog-'+label.replaceAll(' ','_')+'-'+size.width+'.png',fullPage:true});await page.keyboard.press('Escape');}await page.goto('/');await page.getByRole('button',{name:'Neues Turnier'}).click();await page.screenshot({path:'test-results/redesign/create-'+size.width+'.png',fullPage:true});await page.keyboard.press('Escape');}
 await fixture(page,null,'groups');await page.goto('/watch/'+'x'.repeat(43));await page.screenshot({path:'test-results/redesign/groups-mobile.png',fullPage:true});await page.goto('/login');await expect(page.getByLabel('E-Mail',{exact:true})).toBeVisible();await page.screenshot({path:'test-results/redesign/login-mobile.png',fullPage:true});
});

 test('Verwaltungslinks führen zur gemeinsamen Übersicht und alle Admin-Aktionen bleiben erreichbar',async({page})=>{
 const state=await fixture(page);for(const path of ['/admin','/owner']){await page.goto(path);await expect(page).toHaveURL('/');await expect(page.getByRole('heading',{name:'Turniere'})).toBeVisible();await expect(page.getByRole('link',{name:'Verwaltung',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Neues Turnier'})).toBeVisible();}
 await page.goto('/admin/'+state.t.id);await expect(page).toHaveURL('/tournaments/'+state.t.id);await expect(page.getByRole('button',{name:'Zuschauerlink'})).toBeVisible();await page.getByRole('button',{name:'Einstellungen',exact:true}).click();for(const label of ['Archivieren','Änderungshistorie','Teilnehmer, Modus & Auslosung bearbeiten','Turnier endgültig löschen'])await expect(page.getByRole('dialog').getByRole('button',{name:label,exact:true})).toBeVisible();
 });

for(const mode of ['knockout','groups'] as const)test(`Owner passt laufendes ${mode}-Match im Bracket an und setzt es zurück`,async({page})=>{
 const state=await fixture(page,'owner',mode,true);await page.goto(`/tournaments/${state.t.id}`);
 const card=page.locator('.match-card').first();await expect(card).toBeEnabled();await card.click();
 await expect(page.getByRole('button',{name:'Spiel zurücksetzen',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Ergebnis speichern',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Spiel zurücksetzen',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Änderung bestätigen'})).toBeVisible();
 await page.getByRole('button',{name:'Abbrechen',exact:true}).click();expect(state.resets).toBe(0);
 await page.getByRole('button',{name:'Spiel zurücksetzen',exact:true}).click();
 const sent=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/api/game'));
 await page.getByRole('button',{name:'Bestätigen',exact:true}).click();
 expect((await sent).postDataJSON()).toMatchObject({operation:'reset',confirmed:true,expectedVersion:7});
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.resets).toBe(1);
 await card.click();await expect(page.getByRole('button',{name:'Ergebnis speichern',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:'Spiel zurücksetzen',exact:true})).toHaveCount(0);
});

test('Laufende Matches bleiben für Spieler und Zuschauer im Bracket gesperrt',async({page})=>{
 for(const role of ['editor',null] as const){const state=await fixture(page,role,'knockout',true);await page.goto(role===null?'/watch/'+'x'.repeat(43):`/tournaments/${state.t.id}`);await expect(page.locator('button.match-card:not([disabled])')).toHaveCount(0);await expect(page.getByRole('button',{name:'Spiel zurücksetzen',exact:true})).toHaveCount(0);}
});

test('shared-device login is available in the tournament and removes only additional accounts',async({page})=>{
 const state=await fixture(page);let added=false;
 await page.route('**/api/device-accounts',async route=>{if(route.request().method()==='POST')added=false;await route.fulfill({json:{accounts:[{id:'primary',name:'jonas',primary:true},...(added?[{id:'secondary',name:'leon',primary:false}]:[])]}});});
 await page.route('**/api/account',async route=>{expect(route.request().postDataJSON()).toEqual({operation:'device-login',email:'leon@example.test',password:'secondary-password'});added=true;await route.fulfill({json:{ok:true}});});
 await page.goto('/tournaments/'+state.t.id);await page.getByRole('button',{name:'Spieler an diesem Gerät',exact:true}).click();
 await expect(page.locator('.device-accounts')).toContainText('@jonas');await page.getByLabel('E-Mail des weiteren Spielers',{exact:true}).fill('leon@example.test');await page.getByLabel('Passwort des weiteren Spielers',{exact:true}).fill('secondary-password');
 await page.getByRole('button',{name:'Weiteren Spieler anmelden',exact:true}).click();await expect(page.locator('.device-accounts')).toContainText('@leon');await expect(page.getByLabel('Passwort des weiteren Spielers',{exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'Von diesem Gerät abmelden',exact:true}).click();await expect(page.locator('.device-accounts')).not.toContainText('@leon');await expect(page.locator('.device-accounts')).toContainText('@jonas');
});
test('group tournaments offer separate leg goals on creation and after drawing',async({page})=>{
 const state=await fixture(page,'owner','groups');let saved:unknown;
 await page.route('**/api/app',async route=>{if(route.request().method()==='POST'){saved=route.request().postDataJSON();await route.fulfill({json:{ok:true}});}else await route.fallback();});
 await page.goto('/');await page.getByRole('button',{name:'Neues Turnier'}).click();await page.getByRole('combobox',{name:'Turniermodus',exact:true}).selectOption('groups');
 await expect(page.getByLabel('Gewinnlegs Gruppenphase',{exact:true})).toHaveValue('1');await expect(page.getByLabel('Gewinnlegs K.-o.-Phase',{exact:true})).toHaveValue('2');await page.keyboard.press('Escape');
 await page.goto('/tournaments/'+state.t.id);await page.getByRole('button',{name:'Einstellungen',exact:true}).click();
 await page.getByLabel('Gewinnlegs Gruppenphase',{exact:true}).fill('1');await page.getByLabel('Gewinnlegs K.-o.-Phase',{exact:true}).fill('2');await page.getByRole('button',{name:'Gewinnlegs speichern',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(saved).toMatchObject({action:'scoring',id:state.t.id,payload:{start:501,out:'double',groupLegsToWin:1,legsToWin:2}});
});
