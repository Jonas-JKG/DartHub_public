import {NextRequest} from 'next/server';
import {primarySession,playSession,devicePlaySessions} from './play-context';
import {rpc,DatabaseError} from './repositories/supabase';
import type {Session} from './repositories/interface';
/** Admin controls are temporary and never displace a player's saved identity. */
export async function matchIdentity(r:NextRequest,id:string,match:string,knownPrimary?:Session|null,actor?:string){
 const root=knownPrimary===undefined?await primarySession(r):knownPrimary,active=await playSession(r,id,root);
 const attached=r.cookies.get('dartbracket_device_accounts')?.value?await devicePlaySessions(r,id,root,active):[];
 if(actor){const own=attached.find(a=>(a.session.participant_ids??[a.session.participant_id]).includes(actor));if(own)return {root,shadow:false,session:own.session,deviceShared:attached.length>1};}
 const participants=[...new Set(attached.flatMap(a=>a.session.participant_ids??(a.session.participant_id?[a.session.participant_id]:[])))];
 if(root?.role==='owner'&&!root.manager_id){
  try{const available=await rpc('owner_available_players',{p_hash:root.token_hash,p_id:id,p_match:match});
   if(Array.isArray(available)){const players=available.filter((x):x is string=>typeof x==='string'),ids=actor?players:[...new Set([...players,...participants])];return {root,shadow:true,deviceShared:attached.length>1,session:{...root,playing_tournament_id:id,participant_ids:ids,participant_id:ids.includes(active?.participant_id??'')?active!.participant_id:ids[0]??null} as Session};}
  }catch(e){if(!(e instanceof DatabaseError)||!['PGRST202','42883'].includes(e.code))throw e;}
 }
 if(!actor&&participants.length){const base=attached.find(a=>a.session.token_hash===active?.token_hash)?.session??attached[0]?.session??active;return {root,shadow:false,session:base?{...base,participant_ids:participants}:base,deviceShared:true};}
 return {root,shadow:false,session:active,deviceShared:attached.length>1};
}
