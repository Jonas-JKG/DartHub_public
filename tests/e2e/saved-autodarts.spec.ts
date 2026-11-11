import {test,expect,type Page} from '@playwright/test';
import {randomUUID,randomInt} from 'node:crypto';
import {createTournament} from '../../src/domain/tournament';
async function settings(page:Page,role:'owner'|'manager'|'player',linked=false){
 await page.route('**/api/identity',r=>r.fulfill({json:{signedIn:true,role:'owner'}}));
 const t=createTournament({id:randomUUID(),name:'Mein Turnier',names:['Anna','Berta','Clara'],mode:'knockout',groupSize:4,advancePerGroup:2},randomInt,randomUUID),player=t.participants[0].id;
 const session=role==='player'?{role:'editor',playerLocked:true,participantId:player,tournamentId:t.id}:{role:'owner',managerId:role==='manager'?randomUUID():null,participantId:null,tournamentId:null};
 await page.route('**/api/app*',r=>r.fulfill({json:{setup:false,accountsEnabled:true,tournaments:[t],session,activeGames:[]}}));
 const operations:unknown[]=[];
 await page.route('**/api/autodarts',r=>{
  const body=r.request().method()==='POST'?r.request().postDataJSON():null;if(body)operations.push(body);
  if(body?.operation==='login')linked=!!body.remember;if(body?.operation==='disconnect')linked=false;
  return r.fulfill({json:!body?{authenticated:linked,canLink:true,linked,boardId:linked?'saved-board':null,autoConnect:linked}:body.operation==='boards'?{boards:[{id:'first-board',name:'Andere Scheibe'},{id:'saved-board',name:'Gespeicherte Scheibe'}],linked,boardId:linked?'saved-board':null,autoConnect:linked}:body.operation==='login'?{linked,boards:[{id:'saved-board',name:'Gespeicherte Scheibe'}]}:body.operation==='ticket'?{url:'wss://play.ws.autodarts.com/test',boardEmpty:true}:{ok:true}});
 });
 await page.routeWebSocket('wss://play.ws.autodarts.com/**',()=>{});return {t,operations};
}
for(const role of ['owner','manager','player'] as const)test(`${role}: verknüpft Konto, entfernt Passwort und wählt gespeichertes Board beim nächsten Aufruf`,async({page})=>{
 const {operations}=await settings(page,role);await page.goto('/settings');
 await expect(page.getByLabel('Autodarts mit meinem Zugang verknüpfen')).toBeChecked();
 await page.getByLabel('Autodarts E-Mail',{exact:true}).fill('board@example.test');await page.getByLabel('Autodarts Passwort',{exact:true}).fill('secret-password');await page.getByRole('button',{name:'Bei Autodarts anmelden',exact:true}).click();
 expect(operations).toContainEqual({operation:'login',username:'board@example.test',password:'secret-password',remember:true});
 await page.getByRole('button',{name:'Meine Scheibe verbinden',exact:true}).click();await expect(page.getByRole('button',{name:'Automatische Eingabe ausschalten',exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('combobox',{name:'Deine Autodarts-Scheibe',exact:true})).toHaveValue('saved-board');await expect(page.getByRole('button',{name:'Automatische Eingabe ausschalten',exact:true})).toBeVisible();await expect(page.getByLabel('Autodarts Passwort',{exact:true})).toHaveCount(0);
 if(role!=='player')expect(operations).not.toContainEqual({operation:'ticket',boardId:'saved-board'});
 await page.getByRole('button',{name:'Autodarts abmelden',exact:true}).click();await expect(page.getByLabel('Autodarts Passwort',{exact:true})).toHaveValue('');await page.reload();await expect(page.getByLabel('Autodarts Passwort',{exact:true})).toBeVisible();
});
test('Spielerkonto lädt gespeicherte Scheibe ohne erneute Autodarts-Anmeldung',async({page})=>{const {operations}=await settings(page,'player',true);await page.goto('/settings');await expect(page.getByRole('combobox',{name:'Deine Autodarts-Scheibe',exact:true})).toHaveValue('saved-board');await expect(page.getByRole('button',{name:'Automatische Eingabe ausschalten',exact:true})).toBeVisible();expect(operations.some((v:any)=>v.operation==='login')).toBe(false);expect(operations).toContainEqual({operation:'ticket',boardId:'saved-board'});});
test('Widerrufene Provider-Anmeldung verlangt neue Zugangsdaten, ohne die Verknüpfung zu löschen',async({page})=>{
 await settings(page,'manager',true);let deleted=false;await page.route('**/api/autodarts',r=>{if(r.request().method()==='GET')return r.fulfill({json:{authenticated:true,canLink:true,linked:true,boardId:'saved-board',autoConnect:true}});if(r.request().postDataJSON().operation==='disconnect')deleted=true;return r.fulfill({status:502,json:{error:'Bitte erneut bei Autodarts anmelden.'}});});await page.goto('/settings');await expect(page.getByText('Bitte erneut bei Autodarts anmelden.',{exact:true})).toBeVisible();await expect(page.getByLabel('Autodarts Passwort',{exact:true})).toBeVisible();expect(deleted).toBe(false);
});
