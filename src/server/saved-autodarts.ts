import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Session} from './repositories/interface';
import {rpc,DatabaseError} from './repositories/supabase';
import {encrypt,decrypt} from './security';
import {OWNER_MANAGER_ID} from './tenant';
import {refreshAutodarts} from './autodarts';
export class SavedAutodartsError extends Error {constructor(message:string,public status:number,public retryAfter?:number){super(message);}}
export function autodartsAccountKey(s:Session){return s.guest_id&&['guest','editor'].includes(s.role)?'guest:'+s.guest_id:s.role==='editor'&&s.account_manager_id?'manager:'+s.account_manager_id:s.role==='owner'?'manager:'+(s.manager_id??OWNER_MANAGER_ID):s.role==='editor'&&s.player_access_id?'player:'+s.player_access_id:null;}
type Profile={accountKey:string;linked:boolean;boardId:string|null;autoConnect:boolean};
export async function profileOperation(s:Session,operation:string,values:{secret?:string;boardId?:string;lease?:string}={}){
 return await rpc('autodarts_profile',{p_hash:s.token_hash,p_operation:operation,p_secret:values.secret??null,p_board:values.boardId??null,p_lease:values.lease??null});
}
export async function savedAutodartsProfile(s:Session):Promise<Profile|null>{
 if(!autodartsAccountKey(s))return null;
 try{return await profileOperation(s,'read') as Profile;}catch(e){if(e instanceof DatabaseError&&['PGRST202','42883'].includes(e.code))return null;throw e;}
}
function secret(s:Session,refresh:string){return encrypt(JSON.stringify({accountKey:autodartsAccountKey(s),refresh}));}
export async function linkAutodarts(s:Session,refresh:string){await profileOperation(s,'link',{secret:secret(s,refresh)});}
/** Use the database token, not a stale device cookie, and persist every rotation. */
export async function withSavedAutodarts<T>(s:Session,work:(access:string)=>Promise<T>,boardId?:string):Promise<T>{
 const lease=randomUUID();
 const claimed=await profileOperation(s,'claim',{lease}) as {busy?:boolean;secret?:string;accountKey?:string}|null;
 if(claimed?.busy)throw new SavedAutodartsError('Autodarts wird gerade auf einem anderen Gerät verbunden. Bitte kurz erneut versuchen.',409,1);
 if(!claimed?.secret)throw new SavedAutodartsError('Bitte bei Autodarts anmelden.',401);
 try{
  const stored=z.object({accountKey:z.string(),refresh:z.string().min(1).max(1400)}).parse(JSON.parse(decrypt(claimed.secret)));
  if(stored.accountKey!==autodartsAccountKey(s)||claimed.accountKey!==stored.accountKey)throw Error('Invalid profile');
  const a=await refreshAutodarts(stored.refresh);
  // Even a rejected board or image request must save the newly rotated token.
  let value:T|undefined,failure:unknown;
  try{value=await work(a.access_token);}catch(e){failure=e;}
  const done=await profileOperation(s,'finish',{lease,secret:secret(s,a.refresh_token),...(!failure&&boardId?{boardId}:{})}) as {ok:boolean};
  if(!done.ok)throw new SavedAutodartsError('Die Autodarts-Verknüpfung wurde geändert. Bitte erneut verbinden.',409);
  if(failure)throw failure;return value as T;
 }finally{await profileOperation(s,'release',{lease}).catch(()=>{});}
}
