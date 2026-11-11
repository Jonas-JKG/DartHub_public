import {NextRequest} from 'next/server';
import {randomInt,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {accountResponse,AccountRequestError} from '../../../server/account-http';
import {deckAccounts,deckAccess,checkDeckError,publicDeckRoom,publicDeckGame} from '../../../server/dartdeck';
import {managerId} from '../../../server/manager-access';
import {db,rpc,DatabaseError} from '../../../server/repositories/supabase';
import {rateKey} from '../../../server/security';
import type {DeckAction} from '../../../domain/dartdeck';
import {createMinigame,minigameAction,withMinigameHistory} from '../../../domain/minigames';
import {DomainError} from '../../../domain/tournament';
const uuid=z.string().uuid(),settings=z.object({rounds:z.number().int().min(1).max(50),difficulty:z.enum(['easy','mixed','hard']),mode:z.enum(['dartdeck','bingo','tic-tac-toe','connect-four']).optional(),bingoGoal:z.enum(['one-line','two-lines','full-house']).optional(),bingoSize:z.union([z.literal(4),z.literal(8)]).optional()});
const hit=z.object({number:z.number().int().min(0).max(25),multiplier:z.union([z.literal(1),z.literal(2),z.literal(3)]),x:z.number().min(-2).max(2),y:z.number().min(-2).max(2),position:z.object({x:z.number().min(-2).max(2),y:z.number().min(-2).max(2)}).optional()});
const input=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('create'),settings}),
 z.object({operation:z.enum(['invite','remove','accept','decline']),id:uuid,expectedVersion:z.number().int().positive(),target:uuid}),
 z.object({operation:z.literal('local'),id:uuid,expectedVersion:z.number().int().positive(),name:z.string().trim().min(1).max(40)}),
 z.object({operation:z.literal('settings'),id:uuid,expectedVersion:z.number().int().positive(),settings}),
 z.object({operation:z.enum(['start','rematch']),id:uuid,expectedVersion:z.number().int().positive()}),
 z.object({operation:z.literal('delete'),id:uuid,expectedVersion:z.number().int().positive(),confirmed:z.literal(true)}),
 z.object({operation:z.literal('action'),id:uuid,expectedVersion:z.number().int().positive(),actor:uuid,action:z.discriminatedUnion('type',[z.object({type:z.literal('dart'),hit,index:z.number().int().min(0).max(2).optional()}),z.object({type:z.literal('undo')}),z.object({type:z.literal('next')}),z.object({type:z.literal('vote-skip'),agree:z.boolean(),cardDraw:z.number().int().min(0),gameId:uuid})])})
]);
export const dynamic='force-dynamic';export const runtime='nodejs';
function fail(e:unknown){
 if(e instanceof AccountRequestError)return accountResponse({error:e.message},e.status);
 if(e instanceof DomainError||e instanceof z.ZodError||e instanceof SyntaxError)return accountResponse({error:e instanceof DomainError?e.message:'Bitte Eingaben prüfen.'},400);
 if(e instanceof DatabaseError){if(['42P01','PGRST205','PGRST202','42883'].includes(e.code))return accountResponse({error:'Bitte 024_dartdeck.sql im Supabase SQL Editor ausführen.',setupRequired:true},503);if(e.code==='P0002')return accountResponse({error:'Lobby nicht gefunden.'},404);if(e.code==='40001')return accountResponse({error:'Der Stand wurde inzwischen geändert. Bitte erneut versuchen.',conflict:true},409);if(['42501','28000'].includes(e.code))return accountResponse({error:'Keine Berechtigung für diese Aktion.'},403);if(['55000','22023','23505'].includes(e.code))return accountResponse({error:e.code==='23505'?'Dieser Spieler ist bereits eingeladen.':e.message},409);}
 return accountResponse({error:'Minigames sind momentan nicht verfügbar.'},503);
}
export async function GET(r:NextRequest){try{
 const context=await deckAccounts(r);
 if(!await rpc('consume_login_attempt',{p_key:rateKey('dartdeck-read:'+context.root.token_hash),p_max:1800}))throw new AccountRequestError('Zu viele Abrufe. Bitte kurz warten.',429);
 const id=r.nextUrl.searchParams.get('id');
 if(id){uuid.parse(id);const a=await deckAccess(r,id,context);return accountResponse({room:publicDeckRoom(a.room),members:a.members,controlled:a.controlled,host:a.host,accountIds:a.accounts.map(managerId),showManagers:!a.root.manager_id});}
 const membership=await db().from('dartdeck_members').select('room_id').in('account_id',context.accounts.map(managerId));checkDeckError(membership.error);
 const ids=[...new Set((membership.data??[]).map(p=>p.room_id))];
 let q=db().from('dartdeck_rooms').select('id,host_id,phase,settings,version,created_at,updated_at').order('updated_at',{ascending:false}).limit(100);
 if(context.root.manager_id)q=q.or('host_id.eq.'+managerId(context.root)+(ids.length?',id.in.('+ids.join(',')+')':''));
 const result=await q;checkDeckError(result.error);
 return accountResponse({rooms:(result.data??[]).map(row=>({...row,game:null,last_game:null,canDelete:!context.root.manager_id||managerId(context.root)===row.host_id})),accountIds:context.accounts.map(managerId),showManagers:!context.root.manager_id});
}catch(e){return fail(e);}}
export async function POST(r:NextRequest){try{
 if(r.headers.get('origin')!==new URL(process.env.APP_ORIGIN??r.url).origin)throw new AccountRequestError('Diese Anfrage stammt nicht von der Anwendung.',403);
 const text=await r.text();if(text.length>16000)throw new AccountRequestError('Anfrage zu groß.',413);const p=input.parse(JSON.parse(text)),context=await deckAccounts(r);
 if(!await rpc('consume_login_attempt',{p_key:rateKey('dartdeck-'+(p.operation==='action'?'play':'lobby')+':'+context.root.token_hash),p_max:p.operation==='action'?2400:180}))throw new AccountRequestError('Zu viele Aktionen. Bitte kurz warten.',429);
 if(p.operation==='create'){const id=randomUUID();await rpc('dartdeck_lobby',{p_hash:context.root.token_hash,p_operation:'create',p_id:id,p_settings:p.settings});return accountResponse({ok:true,redirect:'/minigames/'+id});}
 const a=await deckAccess(r,p.id,context);if(a.room.version!==p.expectedVersion&&!(p.operation==='action'&&p.action.type==='vote-skip'))return accountResponse({error:'Der Stand wurde inzwischen geändert. Bitte erneut versuchen.',conflict:true},409);
 if(p.operation==='accept'||p.operation==='decline'){
  const member=a.members.find(m=>m.id===p.target),actor=member&&a.accounts.find(s=>managerId(s)===member.account_id);if(!actor||member?.accepted)throw new AccountRequestError('Keine offene Einladung für dieses Konto.',403);
  const result=await rpc(p.operation==='accept'?'accept_account_invitation':'social_dismiss_invitation',{p_hash:actor.token_hash,p_id:p.target});return accountResponse({ok:true,...(p.operation==='accept'?{...(result as object),redirect:'/minigames/'+p.id}:{redirect:'/minigames'})});
 }
 if(p.operation==='start'){
  if(!a.host)throw new AccountRequestError('Nur der Ersteller oder Admin startet die Partie.',403);
  if(a.room.phase!=='waiting')throw new AccountRequestError('Die Partie läuft bereits.',409);
  const players=a.members.filter(m=>m.accepted).map(m=>({id:m.id,name:m.name,accountId:m.account_id,controllerId:m.controller_id}));
  const game=withMinigameHistory(createMinigame(players,a.room.settings,randomInt),a.room.last_game);await rpc('write_dartdeck',{p_hash:a.root.token_hash,p_id:p.id,p_expected:p.expectedVersion,p_actor:null,p_action:'start',p_game:game});return accountResponse({ok:true});
 }
 if(p.operation==='action'){
  const member=a.members.find(m=>m.id===p.actor&&m.accepted),actor=member&&a.accounts.find(s=>managerId(s)===member.controller_id);
  if(!actor||!a.room.game)throw new AccountRequestError('Du kannst nur für deine eigenen Spieler handeln.',403);
  let current=a;
  for(let attempt=0;attempt<4;attempt++){
   if(!current.room.game)throw new AccountRequestError('Die Partie läuft nicht.',409);
   const game=minigameAction(current.room.game,p.actor,p.action as DeckAction,randomInt);
   try{await rpc('write_dartdeck',{p_hash:actor.token_hash,p_id:p.id,p_expected:current.room.version,p_actor:p.actor,p_action:p.action.type,p_game:game});return accountResponse({ok:true,game:publicDeckGame(game),version:current.room.version+1});}
   catch(e){if(p.action.type!=='vote-skip'||!(e instanceof DatabaseError)||e.code!=='40001'||attempt===3)throw e;current=await deckAccess(r,p.id,context);}
  }
 }
 if(!a.host)throw new AccountRequestError('Nur der Ersteller oder Admin verwaltet die Lobby.',403);
 await rpc('dartdeck_lobby',{p_hash:a.root.token_hash,p_operation:p.operation,p_id:p.id,p_expected:p.expectedVersion,...('target' in p?{p_target:p.target}:{}),...('name' in p?{p_name:p.name}:{}),...('settings' in p?{p_settings:p.settings}:{})});
 return accountResponse({ok:true,...(p.operation==='delete'?{redirect:'/minigames'}:{})});
}catch(e){return fail(e);}}
