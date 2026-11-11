import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {createTournament} from '../../src/domain/tournament';
import {createGame} from '../../src/domain/scoring';
function fixture(){const t={...createTournament({id:randomUUID(),kind:'training',name:'Langsame Verbindung',names:['Anna','Berta'],mode:'knockout',groupSize:2,advancePerGroup:1},()=>0,randomUUID),status:'running' as const};return {t,body:{tournament:t,match:t.matches[0],game:createGame(t.matches[0].players as [string,string],t.scoring),session:null}};}
test('Antworten über 600 ms laden das Match ohne parallele Abrufe',async({page})=>{
 const {t,body}=fixture();let active=0,max=0;await page.route('**/api/friends**',r=>r.fulfill({json:{account:false}}));await page.route('**/api/identity',r=>r.fulfill({json:{signedIn:true,role:'owner'}}));await page.route('**/api/game?**',async r=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,1600));try{await r.fulfill({json:body});}finally{active--;}});await page.goto('/training/'+t.id+'/games/'+t.matches[0].id);await expect(page.getByRole('heading',{name:'Wer beginnt?',exact:true})).toBeVisible({timeout:7000});expect(max).toBe(1);
});
test('ein hängender Matchabruf zeigt nach zwölf Sekunden einen Fehler und kann neu gestartet werden',async({page})=>{
 const {t,body}=fixture();let respond=false,requests=0;await page.clock.install();await page.route('**/api/friends**',r=>r.fulfill({json:{account:false}}));await page.route('**/api/identity',r=>r.fulfill({json:{signedIn:true,role:'owner'}}));await page.route('**/api/game?**',r=>{requests++;if(respond)return r.fulfill({json:body});});await page.goto('/training/'+t.id+'/games/'+t.matches[0].id);await expect.poll(()=>requests).toBe(1);await page.clock.runFor(12500);await expect(page.locator('main').getByRole('alert')).toContainText('dauert zu lange');expect(requests).toBeLessThanOrEqual(2);respond=true;await page.getByRole('button',{name:'Erneut versuchen',exact:true}).click();await expect(page.getByRole('heading',{name:'Wer beginnt?',exact:true})).toBeVisible();
});
