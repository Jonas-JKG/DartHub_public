import {NextRequest} from 'next/server';
import {z} from 'zod';
import {configured,DatabaseError,rpc} from './repositories/supabase';
import {accountResponse,AccountRequestError} from './account-http';
import {rateKey} from './security';
export async function socialRequest(r:NextRequest,namespace:string,max=40){
 if(!configured())throw new AccountRequestError('Bitte zuerst Supabase einrichten.',503);
 if(r.headers.get('origin')!==new URL(process.env.APP_ORIGIN??r.url).origin)throw new AccountRequestError('Fremde Anfrage.',403);
 if(!await rpc('social_schema_ready',{}))throw new AccountRequestError('Bitte 014_training_and_friends.sql ausführen.',503);
 const ip=process.env.VERCEL?r.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim()??'unknown':'local';
 if(!await rpc('consume_login_attempt',{p_key:rateKey(namespace+':'+ip+(namespace==='presence'?':'+(r.cookies.get('dartbracket_session')?.value??''):'')),p_max:max}))throw new AccountRequestError('Zu viele Versuche. Bitte später erneut versuchen.',429);
}
export async function socialBody(r:NextRequest){const text=await r.text();if(text.length>5000)throw new AccountRequestError('Anfrage zu groß.',413);return JSON.parse(text);}
export function socialError(e:unknown,migration='014_training_and_friends.sql'){
 if(e instanceof AccountRequestError)return accountResponse({error:e.message},e.status);
 if(e instanceof z.ZodError||e instanceof SyntaxError)return accountResponse({error:'Bitte Eingaben prüfen.'},400);
 if(e instanceof DatabaseError){
  if(['PGRST202','42883','PGRST205','42703'].includes(e.code))return accountResponse({error:'Bitte '+migration+' im Supabase SQL Editor ausführen.'},503);
  if(e.code==='40001')return accountResponse({error:'Der Stand wurde inzwischen geändert. Bitte erneut versuchen.'},409);
  if(e.message==='PLAYER_IN_USE')return accountResponse({error:'Dieser Spieler ist bereits auf einem anderen Gerät angemeldet.',needsTakeover:true},409);
  if(['42501','28000','55000','22023'].includes(e.code))return accountResponse({error:e.message},e.code==='55000'?409:403);
 }
 console.error('Training/Freunde:',e instanceof Error?e.name:'Fehler');return accountResponse({error:'Die Daten konnten nicht geladen oder gespeichert werden.'},503);
}
