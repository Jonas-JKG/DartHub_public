import {NextRequest} from 'next/server';
import {trainingRequest} from '../../../domain/training-request';
import {randomUUID,randomInt} from 'node:crypto';
import {z} from 'zod';
import {accountResponse,AccountRequestError} from '../../../server/account-http';
import {socialRequest,socialBody,socialError} from '../../../server/social-http';
import {primarySession,playSession,setPlayerSession,devicePlaySessions} from '../../../server/play-context';
import {db,rpc,repository,DatabaseError} from '../../../server/repositories/supabase';
import {token,hashToken,encrypt} from '../../../server/security';
import {buildParticipantAccess,managerId,managerProfile} from '../../../server/manager-access';
import {createTournament} from '../../../domain/tournament';
import {createTrainingGame,gameView,checkout,type Game} from '../../../domain/scoring';
export const runtime='nodejs';export const dynamic='force-dynamic';
const uuid=z.string().uuid();
async function modesReady(name='training_modes_ready'){try{return await rpc(name,{})===true;}catch(e){if(e instanceof DatabaseError&&['PGRST202','42883'].includes(e.code))return false;throw e;}}
export async function GET(r:NextRequest){let accountInfo:Record<string,unknown>={signedIn:false};try{
 const root=await primarySession(r),id=r.nextUrl.searchParams.get('id');

 if(root?.role==='owner')accountInfo={signedIn:true,account:true,accountId:managerId(root),accountRole:root.manager_id?'player':'owner',showManagers:!root.manager_id};
 if(!id){
  if(!root||root.role!=='owner')return accountResponse({account:false,signedIn:false,rooms:[]});
  const [profile,ready,clockReady,practiceReady,rooms]=await Promise.all([managerProfile(managerId(root)),modesReady(),modesReady('clock_multiplayer_ready'),modesReady('practice_modes_ready'),rpc('my_training_rooms',{p_hash:root.token_hash})]);
  return accountResponse({...accountInfo,playerName:profile.public_handle||profile.name,modesReady:ready,clockMultiplayerReady:clockReady,practiceModesReady:practiceReady,ready:true,rooms});
 }
 uuid.parse(id);const players=r.cookies.get('dartbracket_device_accounts')?await devicePlaySessions(r,id,root):[];const own=await playSession(r,id);const player=own?.role==='editor'&&own.tournament_id===id?own:players.find(a=>a.session.participant_id)?.session??own;
 const room=await rpc('training_details',{p_hash:player?.token_hash??'',p_id:id,p_account_hash:root?.role==='owner'?root.token_hash:null}) as Record<string,any>;
 const host=root?.role==='owner'&&(managerId(root)===room.hostManagerId||!root.manager_id);
 return accountResponse({...accountInfo,practiceModesReady:room.practiceModesReady===true,modesReady:room.modesReady===true,clockMultiplayerReady:room.clockMultiplayerReady===true,signedIn:!!root,canStart:host||player?.tournament_id===id&&!!player?.participant_ids?.length,room,host,account:root?.role==='owner',participantIds:players.length?[...new Set(players.flatMap(a=>a.session.participant_ids??[]))]:player?.tournament_id===id?player.participant_ids??[player.participant_id]:[],showManagers:root?.role==='owner'&&!root.manager_id});
}catch(e){const failure=socialError(e,'022_clock_multiplayer.sql');return accountResponse({...await failure.json(),...accountInfo,ready:false},failure.status);}}
export async function POST(r:NextRequest){try{
 const p=trainingRequest.parse(await socialBody(r));
 await socialRequest(r,'training:'+p.operation,p.operation==='create'?20:80);
 const root=await primarySession(r),account=root?.role==='owner'?root:null;
 if(p.operation==='create'){
  if(!account)throw new AccountRequestError('Bitte mit deinem Spielerkonto anmelden und Einstellungen wählen.',403);
  if(p.mode==='around-clock'&&!await modesReady())throw new AccountRequestError('Bitte 021_training_modes.sql im Supabase SQL Editor ausführen.',503);
  if((p.mode==='segments'||p.mode==='checkout')&&!await modesReady('practice_modes_ready'))throw new AccountRequestError('Bitte 023_practice_modes.sql im Supabase SQL Editor ausführen.',503);
  const profile=await managerProfile(managerId(account)),name=profile.public_handle||profile.name;
  const id=randomUUID(),t=createTournament({id,kind:'training',name:'Training · '+name,names:[name,name==='Mitspieler'?'Gast':'Mitspieler'],mode:'knockout',groupSize:2,advancePerGroup:1,scoring:p.rules},randomInt,randomUUID);
  t.trainingMode=p.mode;t.practiceSettings=p.practiceSettings;t.scoring=p.mode==='around-clock'?{start:501,out:'single',legsToWin:1}:p.mode==='checkout'||p.mode==='segments'?{...p.rules,legsToWin:1}:p.rules;
  t.managerId=managerId(account);t.createdByName=profile.name;
  const raw=token(),expires=new Date(Date.now()+7*86400000),old=await playSession(r);
  await rpc('create_training_room',{p_hash:account.token_hash,p_state:t,p_credentials:{editor_link_hash:hashToken(token()),editor_pin_hash:'unused',editor_secret:encrypt('{}'),player_codes:await buildParticipantAccess(t)},p_invite_hash:null,p_invite_secret:null,p_token_hash:hashToken(raw),p_expires:expires.toISOString(),p_old_hash:old?.account_session_hash?old.token_hash:null});
  return setPlayerSession(accountResponse({ok:true,redirect:'/training/'+id}),raw,expires);
 }
 if(!p.id)throw new AccountRequestError('Lobby fehlt.',400);
 if(p.operation==='start'){
  const own=await playSession(r,p.id,root),attached=r.cookies.get('dartbracket_device_accounts')?await devicePlaySessions(r,p.id,root):[],player=own?.role==='editor'&&own.tournament_id===p.id?own:attached[0]?.session??own,actor=account&&(!account.manager_id||account.manager_id===player?.manager_id)?account:player;
  if(!actor)throw new AccountRequestError('Bitte zuerst der Lobby beitreten.',403);
  const t=await repository.get(p.id,actor);if(!t)throw new AccountRequestError('Lobby fehlt.',404);
  const room=await rpc('training_details',{p_hash:player?.token_hash??'',p_id:p.id,p_account_hash:account?.token_hash??null}) as {clockMultiplayerReady?:boolean;seats:{position:number;participantId:string;accountId:string|null;local?:boolean}[]};
  const opponent=room.seats.find(s=>s.position===1),clock=t.trainingMode==='around-clock';
  const seats=room.seats.filter(s=>s.position===0||s.accountId||s.local).sort((a,b)=>a.position-b.position),solo=clock?seats.length===1:!!opponent&&!opponent.accountId&&!opponent.local;
  if(solo&&!await modesReady())throw new AccountRequestError('Bitte 021_training_modes.sql im Supabase SQL Editor ausführen.',503);
  if(clock&&seats.length>1&&!room.clockMultiplayerReady)throw new AccountRequestError('Bitte 022_clock_multiplayer.sql im Supabase SQL Editor ausführen.',503);
  const players=clock&&!solo?seats.map(s=>s.participantId):clock?[t.participants[0].id,t.participants.find(p=>p.id!==t.participants[0].id)!.id]:t.matches[0].players as string[];
  const options=t.trainingMode==='checkout'?Array.from({length:131},(_,i)=>40+i).filter(n=>checkout(n,t.scoring!.out).length):[];
  const targets=t.trainingMode==='checkout'?Array.from({length:10},()=>options[randomInt(options.length)]):undefined;
  const g=createTrainingGame(players,t.scoring!,solo,t.trainingMode??'x01',t.participants[0].id,t.practiceSettings,targets);
  if(clock?seats.some(s=>s.local):opponent?.local)g.sharedDevice=true;
  await rpc('start_training_match',{p_hash:actor.token_hash,p_id:p.id,p_game:{...g,activePlayer:g.players[gameView(g).active]}});
  return accountResponse({ok:true,redirect:'/training/'+p.id+'/games/'+t.matches[0].id});
 }
 if(!account)throw new AccountRequestError('Nur der Lobby-Ersteller kann das verwalten.',403);
 await rpc('training_host',{p_hash:account.token_hash,p_id:p.id});
 if(p.operation==='delete'){
  const t=await repository.get(p.id,account);if(!t||t.kind!=='training')throw new AccountRequestError('Lobby nicht verfügbar.',404);
  await repository.remove(p.id,p.expectedVersion,account);return accountResponse({ok:true,redirect:'/training'});
 }
 if(p.operation==='local'){
  await rpc('training_add_local',{p_hash:account.token_hash,p_id:p.id,p_name:p.name});
 }else if(p.operation==='next'){
  if(!p.rules)throw new AccountRequestError('Bitte Regeln wählen.',400);
  await rpc('training_next',{p_hash:account.token_hash,p_id:p.id,p_rules:p.rules});
 }else if(p.operation==='remove'){
  const t=await repository.get(p.id,account);if(!t)throw new AccountRequestError('Lobby fehlt.',404);
  const codes=await buildParticipantAccess(t),index=p.participantId?t.participants.findIndex(member=>member.id===p.participantId):1;
  if(index<1||index>=t.participants.length)throw new AccountRequestError('Dieser Spieler kann nicht entfernt werden.',400);
  await rpc(t.trainingMode==='around-clock'?'training_remove_clock_player':'training_remove_player',{p_hash:account.token_hash,p_id:p.id,...(t.trainingMode==='around-clock'?{p_player:t.participants[index].id}:{}),p_code_hash:codes[index].code_hash,p_secret:codes[index].code_secret});
 }
 return accountResponse({ok:true});
}catch(e){return socialError(e,'022_clock_multiplayer.sql');}}
