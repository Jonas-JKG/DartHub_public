import {NextRequest} from 'next/server';
import {z} from 'zod';
import {primarySession} from '../../../server/play-context';
import {deviceAccounts,setDeviceAccounts} from '../../../server/device-accounts';
import {managerProfile,managerId} from '../../../server/manager-access';
import {db} from '../../../server/repositories/supabase';
import {hashToken} from '../../../server/security';
import {accountResponse,requireAccountRequest,AccountRequestError} from '../../../server/account-http';
export const dynamic='force-dynamic';
export async function GET(r:NextRequest){try{
 const root=await primarySession(r);if(root?.role!=='owner')return accountResponse({error:'Bitte anmelden.'},401);
 const all=[{session:root},...await deviceAccounts(r,root)];
 return accountResponse({accounts:await Promise.all(all.map(async(a,i)=>{const p=await managerProfile(managerId(a.session));return {id:managerId(a.session),name:p.public_handle||p.name,primary:i===0};}))});
}catch{return accountResponse({error:'Konten konnten nicht geladen werden.'},503);}}
export async function POST(r:NextRequest){try{
 await requireAccountRequest(r);const root=await primarySession(r);if(root?.role!=='owner')return accountResponse({error:'Bitte anmelden.'},401);
 const {id}=z.object({id:z.string().uuid()}).parse(await r.json());const all=await deviceAccounts(r,root),selected=all.find(a=>a.session.manager_id===id);
 if(!selected)return accountResponse({error:'Dieses Konto ist nicht zusätzlich angemeldet.'},403);
 const removed=await db().from('sessions').delete().eq('token_hash',hashToken(selected.raw));if(removed.error)throw removed.error;
 return setDeviceAccounts(accountResponse({ok:true}),root,all.filter(a=>a!==selected).map(a=>a.raw));
}catch(e){if(e instanceof AccountRequestError)return accountResponse({error:e.message},e.status);return accountResponse({error:'Konto konnte nicht entfernt werden.'},400);}}
