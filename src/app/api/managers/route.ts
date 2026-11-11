import {NextRequest} from 'next/server';
import {z} from 'zod';
import {AccountRequestError,accountResponse,requestSession,requireAccountRequest} from '../../../server/account-http';
import {db,rpc,DatabaseError} from '../../../server/repositories/supabase';
import {managerProfile,managerId} from '../../../server/manager-access';
import {managerAccountsEnabled,OWNER_MANAGER_ID} from '../../../server/tenant';
export const runtime='nodejs';
export async function GET(r:NextRequest){try{
 if(!managerAccountsEnabled())return accountResponse({error:'Spielerkonten sind noch nicht aktiviert.'},503);
 const s=await requestSession(r);if(s?.role!=='owner')return accountResponse({error:'Keine Berechtigung.'},403);
 if(r.nextUrl.searchParams.has('mine')){const p=await managerProfile(managerId(s));return accountResponse({manager:{id:p.id,name:p.name,url:new URL('/watch/'+p.live.link,process.env.APP_ORIGIN??r.url).href}});}
 if(s.manager_id)return accountResponse({error:'Nur der Admin verwaltet Spielerkonten.'},403);
 const target=r.nextUrl.searchParams.get('manager');if(target){const parsed=z.string().uuid().safeParse(target);if(!parsed.success)return accountResponse({error:'Ungültiges Spielerkonto.'},400);const {data,error}=await db().from('managers').select('id,name').eq('id',parsed.data).maybeSingle();if(error)throw error;return data?accountResponse({manager:data}):accountResponse({error:'Spielerkonto nicht gefunden.'},404);}
 const managers=await rpc('admin_player_accounts',{p_hash:s.token_hash}) as {id:string}[];const flags=await db().from('managers').select('id,camera_enabled');return accountResponse({managers:managers.map(m=>({...m,camera_enabled:flags.data?.find(f=>f.id===m.id)?.camera_enabled===true}))});
 }catch{return accountResponse({error:'Spielerverwaltung nicht verfügbar. Bitte 017_account_lobbies.sql prüfen.'},503);}}
export async function POST(r:NextRequest){try{
 await requireAccountRequest(r);const s=await requestSession(r);if(s?.role!=='owner'||s.manager_id)return accountResponse({error:'Nur der Admin verwaltet Spielerkonten.'},403);
 const text=await r.text();if(text.length>1000)return accountResponse({error:'Ungültige Anfrage.'},400);
 const p=z.object({id:z.uuid(),operation:z.enum(['enable','disable','approve','delete']),confirmation:z.string().max(254).optional()}).parse(JSON.parse(text));if(p.id===OWNER_MANAGER_ID)return accountResponse({error:'Der Admin bleibt aktiv.'},400);
 if(p.operation==='delete'){
  const existing=await db().from('managers').select('email').eq('id',p.id).maybeSingle();if(existing.error)throw existing.error;if(!existing.data)return accountResponse({error:'Spielerkonto nicht gefunden.'},404);
  if(p.confirmation!==existing.data.email)return accountResponse({error:'Bitte zum Löschen die E-Mail-Adresse des Spielers exakt bestätigen.'},409);
  if(!await rpc('prepare_manager_deletion',{p_hash:s.token_hash,p_id:p.id}))return accountResponse({error:'Spielerkonto nicht gefunden.'},404);
  const deleted=await db().auth.admin.deleteUser(p.id);
  if(deleted.error&&deleted.error.status!==404&&deleted.error.code!=='user_not_found')return accountResponse({error:'Der Zugang ist gesperrt und seine Turniere wurden zum Admin verschoben. Das Auth-Konto konnte noch nicht gelöscht werden. Bitte Löschung erneut ausführen.'},503);
  const finished=await db().from('managers').update({auth_deleted_at:new Date().toISOString(),email:'deleted:'+p.id,name:'Gelöschtes Konto'}).eq('id',p.id);if(finished.error)throw finished.error;
  return accountResponse({ok:true});
 }
 try{await rpc('manage_manager_status',{p_hash:s.token_hash,p_id:p.id,p_operation:p.operation});}
 catch(e){if(!(e instanceof DatabaseError)||!['PGRST202','42883'].includes(e.code))throw e;const patch=p.operation==='approve'?{approved:true}:{enabled:p.operation==='enable'};const {error}=await db().from('managers').update(patch).eq('id',p.id);if(error)throw error;}
 return accountResponse({ok:true});
 }catch(e){if(e instanceof AccountRequestError)return accountResponse({error:e.message},e.status);return accountResponse({error:e instanceof DatabaseError&&['PGRST202','42883'].includes(e.code)?'Bitte zuerst 013_shared_players_and_managers.sql in Supabase ausführen.':'Spielerkonto konnte nicht geändert werden.'},400);}}
