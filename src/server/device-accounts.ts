import {sessionCookieExpiry} from './session-lifetime';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {encrypt,decrypt} from './security';
import {repository} from './repositories/supabase';
import type {Session} from './repositories/interface';
export const deviceAccountsCookie='dartbracket_device_accounts';
const stored=z.object({parent:z.string().min(1),tokens:z.array(z.string().min(20).max(100)).max(5)});
/** Additional verified sessions are encrypted, HttpOnly and bound to this exact primary login. */
export function deviceTokens(r:NextRequest,root:Session|null):string[]{
 if(!root||root.role!=='owner')return [];
 try{const data=stored.parse(JSON.parse(decrypt(r.cookies.get(deviceAccountsCookie)?.value??'')));return data.parent===root.token_hash?[...new Set(data.tokens)]:[];}catch{return [];}
}
export async function deviceAccounts(r:NextRequest,root:Session|null){
 const accounts=await Promise.all(deviceTokens(r,root).map(async raw=>({raw,session:await repository.session(raw)})));
 return accounts.filter((a):a is {raw:string;session:Session}=>!!a.session&&a.session.role==='owner'&&!!a.session.manager_id&&a.session.token_hash!==root?.token_hash);
}
export function setDeviceAccounts(response:NextResponse,root:Session,tokens:string[]){
 if(!tokens.length){response.cookies.delete(deviceAccountsCookie);return response;}
 response.cookies.set(deviceAccountsCookie,encrypt(JSON.stringify({parent:root.token_hash,tokens})),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',expires:sessionCookieExpiry(root.expires_at)});return response;
}
