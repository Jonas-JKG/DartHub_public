import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
for(const mode of ['signup','magiclink','recovery','fragment'])test(mode==='recovery'?'Wiederherstellung ändert das Passwort und widerruft alte App-Sitzungen':mode==='magiclink'?'Erneute Bestätigung per Magic Link erzeugt eine Spielersitzung':mode==='fragment'?'Standard-E-Mail-Link mit URL-Fragment bestätigt den Spieler':'Bestätigungslink erzeugt eine Manager-Sitzung und entfernt Provider-Tokens',async({page})=>{
 await page.route('**/api/identity',r=>r.fulfill({json:{signedIn:true,role:'owner'}}));
 const recovery=mode==='recovery';
 const id=randomUUID(),user={id,aud:'authenticated',role:'authenticated',email:'verified@example.test',email_confirmed_at:'2026-10-13T10:00:00Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{name:'Verifizierter Manager'},created_at:'2026-10-13T10:00:00Z'};
 const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture-signature';
 let passwordSaved=false,sessionCreated=false,revoked=false,verifications=0;
 await page.route('**/auth/v1/verify',r=>{verifications++;expect(r.request().postDataJSON().type).toBe(mode);return r.fulfill({json:{access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'fixture-refresh-token',user}});});
 await page.route('**/auth/v1/logout**',r=>r.fulfill({json:{}}));
 await page.route('**/auth/v1/user',r=>{if(r.request().method()==='PUT')passwordSaved=r.request().postDataJSON().password==='replacement-password-123';return r.fulfill({json:user});});
 await page.route('**/api/account',r=>{const body=r.request().postDataJSON();if(body.operation==='session'){sessionCreated=body.accessToken===token;}if(body.operation==='revoke-sessions')revoked=true;return r.fulfill({json:{ok:true,redirect:'/'}});});
 await page.route('**/api/app**',r=>r.fulfill({json:{setup:false,accountsEnabled:true,tournaments:[],activeGames:[],liveId:null,session:{role:'owner',managerId:id,tournamentId:null}}}));
 await page.goto(mode==='fragment'?'/auth/confirm#'+new URLSearchParams({access_token:token,refresh_token:'fixture-refresh-token',expires_in:'3600',token_type:'bearer',type:'signup'}):'/auth/confirm?token_hash=fixture-confirmation&type='+mode);
 if(recovery){await expect(page.getByLabel('Neues Passwort',{exact:true})).toBeVisible();await page.getByLabel('Neues Passwort',{exact:true}).fill('replacement-password-123');await page.getByRole('button',{name:'Passwort speichern',exact:true}).click();await expect(page.getByRole('status')).toContainText('Passwort geändert');expect(passwordSaved).toBe(true);expect(revoked).toBe(true);expect(sessionCreated).toBe(false);}
 else{await expect(page).toHaveURL(/:\d+\/$/);await expect(page.getByRole('button',{name:'Neues Turnier'})).toBeVisible();expect(sessionCreated).toBe(true);}
 expect(new URL(page.url()).searchParams.has('token_hash')).toBe(false);expect(verifications).toBe(mode==='fragment'?0:1);expect(await page.evaluate(()=>Object.values(localStorage).some(value=>String(value).includes('fixture-refresh-token')))).toBe(false);
});
test('abgelaufener E-Mail-Link erstellt keine App-Sitzung',async({page})=>{
 let created=false;await page.route('**/auth/v1/verify',r=>r.fulfill({status:400,json:{error_code:'otp_expired',msg:'expired'}}));await page.route('**/api/account',r=>{created=true;return r.fulfill({json:{ok:true}});});
 await page.goto('/auth/confirm?token_hash=expired-fixture&type=signup');await expect(page.getByRole('status')).toContainText('ungültig oder abgelaufen');expect(created).toBe(false);
});
