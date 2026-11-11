import {NextRequest,NextResponse} from 'next/server';
import {deviceAccounts} from './device-accounts';
import type {Session} from './repositories/interface';
import {repository,db,rpc} from './repositories/supabase';
export const playerCookie='dartbracket_player';
export async function primarySession(r:{cookies:{get:(name:string)=>{value:string}|undefined}}){const raw=r.cookies.get('dartbracket_session')?.value;const s=raw?await repository.session(raw):null;return s?.role==='guest'||s?.role==='viewer'?null:s;}
/** A player cookie can never inherit authority from a different signed-in account. */
export async function playSession(r:NextRequest,id?:string|null,knownPrimary?:Session|null){
 const root=knownPrimary===undefined?await primarySession(r):knownPrimary,raw=r.cookies.get(playerCookie)?.value;
 if(root&&root.role==='owner'&&raw){const child=await repository.session(raw);if(child?.account_session_hash===root.token_hash&&(!id||child.tournament_id===id))return child;}
 if(root?.role==='owner'&&id){const player=await rpc('account_play_session',{p_hash:root.token_hash,p_id:id}) as Session|null;return player?.role==='editor'&&player.account_session_hash===root.token_hash?player:root;}
 return root;
}
export function setPlayerSession(r:NextResponse,raw:string,expires:Date){r.cookies.set(playerCookie,raw,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',expires});return r;}
export async function clearPlayerSession(r:NextRequest){const root=await primarySession(r),raw=r.cookies.get(playerCookie)?.value;if(root&&raw){const child=await repository.session(raw);if(child?.account_session_hash===root.token_hash)await db().from('sessions').delete().eq('token_hash',child.token_hash);}}

/** Derive each player's existing scoped session; never combine SQL write privileges. */
export async function devicePlaySessions(r:NextRequest,id:string,root:Session|null,primaryActive?:Session|null){
 if(!root)return [];
 const extra=await deviceAccounts(r,root);
 const roots=[root,...extra.map(a=>a.session)];
 const sessions=await Promise.all(roots.map(async(account,i)=>({root:account,session:i===0?(primaryActive===undefined?await playSession(r,id,account):primaryActive):await rpc('account_play_session',{p_hash:account.token_hash,p_id:id}) as Session|null})));
 return sessions.filter((a):a is {root:Session;session:Session}=>!!a.session&&a.session.account_session_hash===a.root.token_hash&&a.session.tournament_id===id);
}
