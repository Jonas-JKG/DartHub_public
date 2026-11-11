import {NextRequest,NextResponse} from 'next/server';
import {configured,repository,rpc,managerSchemaReady} from './repositories/supabase';
import {rateKey} from './security';
import {managerAccountsEnabled} from './tenant';
export class AccountRequestError extends Error {constructor(message:string,public status:number){super(message);}}
export function accountResponse(data:unknown,status=200){return NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});}
export function setAppSession(response:NextResponse,raw:string,expires:Date){response.cookies.delete('dartbracket_device_accounts');response.cookies.delete('dartbracket_player');response.cookies.delete('dartbracket_guest');response.cookies.set('dartbracket_session',raw,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',expires});return response;}
export function clearAppSession(response:NextResponse){for(const name of ['dartbracket_session','dartbracket_player','dartbracket_guest','dartbracket_device_accounts'])response.cookies.delete(name);return response;}
export async function requireAccountRequest(r:NextRequest){
 if(!configured()||!managerAccountsEnabled())throw new AccountRequestError('Die Spieleranmeldung ist noch nicht eingerichtet.',503);
 if(r.headers.get('origin')!==new URL(process.env.APP_ORIGIN??r.url).origin)throw new AccountRequestError('Fremde Anfrage.',403);
 if(!await managerSchemaReady())throw new AccountRequestError('Bitte zuerst 011_manager_accounts.sql ausführen.',503);
 const ip=process.env.VERCEL?r.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim()??'unknown':'local';
 if(!await rpc('consume_login_attempt',{p_key:rateKey('account:'+ip),p_max:30}))throw new AccountRequestError('Zu viele Versuche. Bitte nach 15 Minuten erneut versuchen.',429);
}
export async function requestSession(r:NextRequest){const raw=r.cookies.get('dartbracket_session')?.value;return raw?repository.session(raw):null;}
