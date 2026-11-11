import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {createTournament,type Tournament} from '../../src/domain/tournament';
import {createTrainingGame,gameAction,gameView,keypadHit,type Game} from '../../src/domain/scoring';
for(const mode of ['segments','checkout'] as const)test(mode+' can be selected, configured, played and confirmed into statistics',async({page})=>{
 let t:Tournament|undefined,game:Game|null=null,phase='waiting';const requests:any[]=[];
 await page.addInitScript(()=>{localStorage.setItem('match-input-mode','keyboard');localStorage.setItem('match-fullscreen','off');localStorage.setItem('dartbracket-language','en');});
 await page.route('**/api/identity',r=>r.fulfill({json:{signedIn:true,role:'owner'}}));await page.route('**/api/friends**',r=>r.fulfill({json:{account:true,friends:[],invitations:[]}}));await page.route('**/api/autodarts**',r=>r.fulfill({json:{canLink:true,authenticated:false}}));await page.route('**/api/game-image**',r=>r.fulfill({json:{image:null}}));
 await page.route('**/api/training**',r=>{
  if(r.request().method()==='POST'){
   const p=r.request().postDataJSON();requests.push(p);
   if(p.operation==='create'){
    t={...createTournament({id:randomUUID(),kind:'training',name:'Practice',names:['Player','Unused'],mode:'knockout',groupSize:2,advancePerGroup:1,scoring:{...p.rules,legsToWin:1}},()=>0,randomUUID),trainingMode:p.mode,practiceSettings:p.practiceSettings};
    return r.fulfill({json:{ok:true,redirect:'/training/'+t.id}});
   }
   if(p.operation==='start'){
    phase='playing';t!.status='running';t!.matches[0].status='running';game=createTrainingGame(t!.matches[0].players as string[],t!.scoring!,true,mode,t!.participants[0].id,t!.practiceSettings,mode==='checkout'?Array(10).fill(40):undefined);
    // Start on the last task; domain tests replay complete sessions separately.
    for(let i=0;i<9;i++){for(let dart=0;dart<3;dart++)game=gameAction(game,t!.participants[0].id,{type:'dart',hit:keypadHit(0,1)});game=gameAction(game,t!.participants[0].id,{type:'next'});}
    return r.fulfill({json:{ok:true,redirect:'/training/'+t!.id+'/games/'+t!.matches[0].id}});
   }
  }
  return r.fulfill({json:{account:true,modesReady:true,practiceModesReady:true,playerName:'Player',host:true,canStart:true,participantIds:t?[t.participants[0].id]:[],rooms:[],...(t?{room:{id:t.id,phase,round:1,matchId:t.matches[0].id,tournament:t,game,seats:t.participants.map((p,i)=>({position:i,participantId:p.id,accountId:i===0?'self':null,ready:i===0}))}}:{})}});
 });
 await page.route(/\/api\/game(?:\?|$)/,r=>{
  if(r.request().method()==='POST'){
   const p=r.request().postDataJSON();if(p.operation==='presence')return r.fulfill({json:{ok:true}});game=gameAction(game!,p.actor,p.action);if(game.phase==='finished'){t!.status='completed';t!.matches[0].status='finished';}return r.fulfill({json:{ok:true,game}});
  }
  return r.fulfill({json:{tournament:t,match:t!.matches[0],game,session:{role:'editor',tournamentId:t!.id,participantId:t!.participants[0].id,participantIds:[t!.participants[0].id]}}});
 });
 await page.goto('/training');await page.getByRole('combobox',{name:'Game mode',exact:true}).selectOption(mode);
 if(mode==='segments'){await page.locator('.segment-picker').getByLabel('19',{exact:true}).check();await page.locator('.segment-picker').getByLabel('18',{exact:true}).check();}else await page.getByLabel('Checkout',{exact:true}).selectOption('double');
 await page.getByRole('button',{name:'Open lobby',exact:true}).click();await expect(page.getByRole('button',{name:'Add player',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Start match',exact:true}).click();await expect(page.locator('.game-player')).toHaveCount(1);
 if(mode==='segments'){for(let i=0;i<3;i++){await page.locator('.number-pad').getByRole('button',{name:'20',exact:true}).click();await expect(page.locator('.visit-darts .has-hit')).toHaveCount(i+1);}}else{await page.getByRole('button',{name:'Double',exact:true}).click();await page.locator('.number-pad').getByRole('button',{name:'20',exact:true}).click();}
 await page.locator('.celebration-actions').getByRole('button',{name:'Next →',exact:true}).click();await expect(page).toHaveURL('/training/'+t!.id);await expect(page.locator('.compact-stats')).toContainText(mode==='segments'?'Segment practice':'Random checkout');expect(gameView(game!).legs[game!.starter??0]).toBe(1);
 expect(requests[0].mode).toBe(mode);if(mode==='segments')expect(requests[0].practiceSettings.segments).toEqual([20,19,18]);else expect(requests[0].rules.out).toBe('double');
});
