import {randomUUID} from 'node:crypto';
import {db,rpc} from './repositories/supabase';
import {rateKey} from './security';
import {accountResponse} from './account-http';
export type MailOperation='signup'|'resend'|'recover';
type Stage='create-account'|'request-mail';
type ProviderError={code?:string;status?:number;message:string};
export const mailKey=(address:string,purpose:string)=>rateKey('account-mail:'+purpose+':'+address);
export const mailWait=(address:string,purpose:string,claim=false)=>rpc('account_email_wait',{p_key:mailKey(address,purpose),p_claim:claim,p_seconds:60}) as Promise<number>;
export async function mailEvent(operation:MailOperation,stage:Stage,error?:ProviderError){
 const id=randomUUID(),code=error?.code&&/^[a-z0-9_]{1,80}$/.test(error.code)?error.code:null;
 // Never log raw provider messages: some include the recipient or SMTP credentials.
 try{
  const {error:writeError}=await db().from('account_mail_events').insert({id,operation,stage,outcome:error?'rejected':'accepted',provider_code:code,provider_status:error?.status??null});
  if(writeError)console.error('Account mail diagnostic unavailable',{id});
 }catch{console.error('Account mail diagnostic unavailable',{id});}
 if(error)console.error('Account mail request rejected',{id,operation,stage,code,status:error.status??null});
 return id;
}
export async function mailFailure(operation:MailOperation,address:string,stage:Stage,error:ProviderError){
 const reference=await mailEvent(operation,stage,error),purpose=operation==='recover'?'recover':'signup';
 const confirmationRequired=stage==='request-mail'&&operation!=='recover';
 const limited=error.status===429||/rate.?limit|security purposes|(?:after|wait).*\d+\s*seconds?/i.test(error.message);
 await db().from('account_email_cooldowns').delete().eq('key',mailKey(address,purpose));
 if(limited){
  const seconds=Math.min(3600,Math.max(60,Number(error.message.match(/(\d+)\s*seconds?/i)?.[1]??60)));
  for(const kind of ['signup','recover'])await rpc('account_email_backoff',{p_key:mailKey(address,kind),p_seconds:seconds});
  const response=accountResponse({error:`Der E-Mail-Dienst verlangt eine Pause. Erneut versuchen in ${seconds} Sekunden.`,retryAfter:seconds,purpose,shared:true,reference,confirmationRequired},429);
  response.headers.set('Retry-After',String(seconds));return response;
 }
 const explanation=stage==='create-account'?'Das Konto konnte nicht angelegt werden. Der Betreiber muss die Supabase-Anmeldung prüfen.':error.code==='email_provider_disabled'?'Der E-Mail-Versand ist im verbundenen Supabase-Projekt deaktiviert. Der Betreiber muss Email und Magic Links aktivieren.':'Supabase hat den Mailversand abgelehnt. Der Betreiber muss SMTP und die Supabase Auth Logs prüfen.';
 return accountResponse({error:explanation+' Referenz: '+reference,reference,confirmationRequired},503);
}
