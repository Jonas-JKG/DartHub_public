import {test,expect} from '@playwright/test';

for(const path of ['/training','/settings','/friends'])for(const language of ['de','en']){
 test(`${path}: ${language} header signs out, handles errors and prevents duplicate requests`,async({page})=>{
  await page.addInitScript(lang=>localStorage.setItem('dartbracket-language',lang),language);
  await page.route('**/api/identity',r=>r.fulfill({json:{signedIn:true,role:'owner'}}));
  await page.route('**/api/training**',r=>r.fulfill({json:{account:true,rooms:[],playerName:'anna'}}));
  await page.route('**/api/friends**',r=>r.fulfill({json:{account:true,friends:[],invitations:[]}}));
  await page.route('**/api/autodarts**',r=>r.fulfill({json:{canLink:true,authenticated:false}}));
  let requests=0,release=false;
  await page.route('**/api/app**',async r=>{
   if(r.request().method()==='POST'){
    expect(r.request().postDataJSON()).toEqual({action:'logout'});requests++;
    if(requests===1){while(!release)await new Promise(resolve=>setTimeout(resolve,20));await r.fulfill({status:500,json:{error:'Server error'}});}
    else await r.fulfill({json:{ok:true}});
   }else await r.fulfill({json:{accountsEnabled:true,tournaments:[],session:{role:'owner',managerId:null}}});
  });
  await page.goto(path);
  const header=page.locator('header.topbar');
  const button=header.getByRole('button',{name:language==='en'?'Sign out':'Abmelden',exact:true});
  await expect(button).toBeVisible();
  await expect(header.getByRole('link',{name:/Mein Konto|My account/})).toHaveCount(0);
  await button.click();
  await expect(header.getByRole('button')).toBeDisabled();
  expect(requests).toBe(1);release=true;
  await expect(header.getByRole('alert')).toHaveText(language==='en'?'Sign-out failed.':'Abmelden fehlgeschlagen.');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('navigation')).toHaveCount(0);
  expect(requests).toBe(2);
 });
}
