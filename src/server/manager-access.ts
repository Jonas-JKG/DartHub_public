import {normalizeUsername,usernamePattern} from '../domain/username';
import { db, DatabaseError, rpc } from './repositories/supabase';
import { encrypt,decrypt,hashToken,token } from './security';
import { OWNER_MANAGER_ID } from './tenant';
import {requireVerifiedEmail,recordVerifiedEmail} from './email-verification';
import type {Session,ParticipantAccess} from './repositories/interface';
import type {Tournament} from '../domain/tournament';
/** Internal participant bindings used by the scoring engine, never sign-in codes. */
export async function buildParticipantAccess(t:Tournament):Promise<ParticipantAccess[]> {
 return t.participants.map(p=>{const secret=token();return {participant_id:p.id,code_hash:hashToken(secret),code_secret:encrypt(secret)};});
}
export async function managerProfile(id:string) {
 for(let attempt=0;attempt<5;attempt++){
  const {data,error}=await db().from('managers').select('*').eq('id',id).single();if(error)throw new DatabaseError(error.message,error.code);
  if(!data.enabled||!data.approved)throw new Error('Dieser Spielerzugang wurde deaktiviert.');
  if(data.live_secret)return {...data,live:JSON.parse(decrypt(data.live_secret)) as {link:string}};
  const link=token();
  const saved=await db().from('managers').update({live_token_hash:hashToken(link),live_secret:encrypt(JSON.stringify({link}))}).eq('id',id).is('live_token_hash',null);
  if(saved.error&&saved.error.code!=='23505')throw new DatabaseError(saved.error.message,saved.error.code);
 }
 throw new Error('Zuschauerzugang konnte nicht erstellt werden. Bitte erneut versuchen.');
}
export async function createManagerSession(user:{id:string;email?:string;email_confirmed_at?:string;confirmation_sent_at?:string;user_metadata?:Record<string,unknown>},emailProof=false) {
 await requireVerifiedEmail(user,emailProof);
 if(!user.email)throw new Error('E-Mail fehlt.');
 const name=typeof user.user_metadata?.name==='string'?user.user_metadata.name.trim().slice(0,80):user.email.split('@')[0];
 const {error}=await db().from('managers').upsert({id:user.id,email:user.email.trim().toLowerCase(),name:name||'Spieler',approved:true},{onConflict:'id',ignoreDuplicates:true});
 if(error)throw new DatabaseError(error.message,error.code);
 if(emailProof)await recordVerifiedEmail(user);
 const profile=await managerProfile(user.id);
 let actualHandle=profile.public_handle;
 const username=typeof user.user_metadata?.username==='string'?normalizeUsername(user.user_metadata.username):null;
 if(!profile.public_handle&&username&&usernamePattern.test(username)){
  const assigned=await db().from('managers').update({public_handle:username}).eq('id',user.id).is('public_handle',null);
  if(assigned.error&&assigned.error.code!=='23505')throw new DatabaseError(assigned.error.message,assigned.error.code);
  if(!assigned.error)actualHandle=username;
 }

 const raw=token(),expires=new Date(Date.now()+7*86400000);
 const result=await db().from('sessions').insert({token_hash:hashToken(raw),role:'owner',tournament_id:null,manager_id:user.id,credential_version:1,expires_at:expires.toISOString()});
 if(result.error)throw new DatabaseError(result.error.message,result.error.code);
 return {raw,expires,redirect:!actualHandle||!profile.onboarding_completed_at?'/account/setup':'/'};
}
export const managerId=(s:Session)=>s.manager_id??OWNER_MANAGER_ID;
