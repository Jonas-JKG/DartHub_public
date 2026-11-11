import {deviceAccounts,setDeviceAccounts} from '../../../server/device-accounts';
import {primarySession} from '../../../server/play-context';
import {hashToken} from '../../../server/security';
import {NextRequest} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {normalizeUsername,usernamePattern} from '../../../domain/username';
import {AccountRequestError,accountResponse,setAppSession,clearAppSession,requireAccountRequest} from '../../../server/account-http';
import {db,rpc} from '../../../server/repositories/supabase';
import {rateKey} from '../../../server/security';
import {mailWait as wait,mailEvent,mailFailure} from '../../../server/account-mail';
import {EmailVerificationRequired,hasEmailProofInValidatedToken,requireVerifiedEmail,recordVerifiedEmail} from '../../../server/email-verification';
import {createManagerSession} from '../../../server/manager-access';
export const runtime='nodejs';
const email=z.string().trim().toLowerCase().pipe(z.email().max(254));
const usernameSchema=z.string().transform(normalizeUsername).pipe(z.string().regex(usernamePattern));
export async function POST(r:NextRequest){
 let switching=false,authenticated=false;
 async function handleRequest(){try{
  await requireAccountRequest(r);
  const text=await r.text();if(text.length>12000)return accountResponse({error:'Anfrage zu groß.'},413);
  const p=z.discriminatedUnion('operation',[
   z.object({operation:z.literal('signup'),email,password:z.string().min(12).max(200),username:usernameSchema}),
   z.object({operation:z.literal('login'),email,password:z.string().min(1).max(200)}),
   z.object({operation:z.literal('device-login'),email,password:z.string().min(1).max(200)}),
   z.object({operation:z.literal('session'),accessToken:z.string().min(1).max(10000)}),
   z.object({operation:z.literal('recover'),email}),
   z.object({operation:z.literal('resend'),email}),
   z.object({operation:z.literal('mail-status'),email}),
   z.object({operation:z.literal('revoke-sessions'),accessToken:z.string().min(1).max(10000)})
  ]).parse(JSON.parse(text));
  switching=['signup','login','session','revoke-sessions'].includes(p.operation);
  if(p.operation==='mail-status')return accountResponse({signup:await wait(p.email,'signup'),recover:await wait(p.email,'recover')});
  const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const redirect=new URL('/auth/confirm',process.env.APP_ORIGIN??r.url).href;
  if(p.operation==='signup'||p.operation==='resend'||p.operation==='recover'){
   const purpose=p.operation==='recover'?'recover':'signup';
   if(p.operation==='signup'){
    if(!await rpc('reserve_player_username',{p_handle:p.username,p_email_key:rateKey('username-email:'+p.email)}))return accountResponse({error:'Dieser Nutzername ist bereits vergeben. Bitte einen anderen wählen.'},409);
   }
   const remaining=await wait(p.email,purpose,true);
   if(remaining>0){const response=accountResponse({error:`Bitte noch ${remaining} Sekunden warten.`,retryAfter:remaining,purpose},429);response.headers.set('Retry-After',String(remaining));return response;}
   if(p.operation==='signup'){
    // Admin createUser sends no mail and cannot silently sign the browser in.
    // Explicitly leave Auth unconfirmed regardless of the project's auto-confirm setting.
    const created=await db().auth.admin.createUser({email:p.email,password:p.password,email_confirm:false,user_metadata:{name:p.username,username:p.username}});
    if(created.error&&!['email_exists','user_already_exists'].includes(created.error.code??''))return await mailFailure(p.operation,p.email,'create-account',created.error);
    // Existing accounts retain their password, name and permissions. Never update by claimed email.
   }
   const result=p.operation==='recover'
    ?await auth.auth.resetPasswordForEmail(p.email,{redirectTo:redirect})
    :await auth.auth.signInWithOtp({email:p.email,options:{emailRedirectTo:redirect,shouldCreateUser:false}});
   if(result.error)return await mailFailure(p.operation,p.email,'request-mail',result.error);
   const reference=await mailEvent(p.operation,'request-mail');
   return accountResponse({ok:true,mailAccepted:true,confirmationRequired:p.operation!=='recover',purpose,retryAfter:60,reference,message:p.operation==='recover'?'Supabase hat die Anfrage angenommen. Falls ein Konto existiert, erhältst du den Link zum Zurücksetzen.':'Supabase hat die Mailanforderung angenommen. Öffne den Bestätigungslink in deinem Postfach; prüfe auch Spam. Ohne Bestätigung bleibt der Zugang gesperrt.'});
  }

  const root=p.operation==='device-login'?await primarySession(r):null;
  if(p.operation==='device-login'&&root?.role!=='owner')return accountResponse({error:'Bitte zuerst mit deinem Konto anmelden.'},401);
  const attached=p.operation==='device-login'?await deviceAccounts(r,root):[];
  if(p.operation==='device-login'&&attached.length>=5)return accountResponse({error:'Höchstens sechs Konten an einem Gerät möglich.'},400);
  let user,emailProof=false;
  if(p.operation==='login'||p.operation==='device-login'){
   const result=await auth.auth.signInWithPassword({email:p.email,password:p.password});
   if(result.error||!result.data.user)return accountResponse({error:result.error?.code==='email_not_confirmed'?'Bitte bestätige zuerst deine E-Mail-Adresse.':'Anmeldung nicht möglich. Zugangsdaten prüfen und E-Mail bestätigen.',...(result.error?.code==='email_not_confirmed'?{confirmationRequired:true}:{})},401);user=result.data.user;
  }else{
   const result=await auth.auth.getUser(p.accessToken);if(result.error||!result.data.user)return accountResponse({error:'Bestätigungslink ungültig oder abgelaufen.'},401);user=result.data.user;emailProof=hasEmailProofInValidatedToken(p.accessToken,user.email);
  }
  if(p.operation==='revoke-sessions'){await requireVerifiedEmail(user,emailProof);if(emailProof)await recordVerifiedEmail(user,true);const removed=await db().from('sessions').delete().eq('manager_id',user.id).eq('role','owner');if(removed.error)throw removed.error;return accountResponse({ok:true});}
  if(p.operation==='device-login'&&(user.id===root?.manager_id||attached.some(a=>a.session.manager_id===user.id)))return accountResponse({error:'Dieses Konto ist bereits an diesem Gerät angemeldet.'},409);
  const {raw,expires,redirect:sessionRedirect}=await createManagerSession(user,emailProof);
  if(p.operation==='device-login'&&root){if(sessionRedirect==='/account/setup'){await db().from('sessions').delete().eq('token_hash',hashToken(raw));return accountResponse({error:'Bitte dieses Konto zuerst vollständig einrichten.'},400);}return setDeviceAccounts(accountResponse({ok:true}),root,[...attached.map(a=>a.raw),raw]);}
  authenticated=true;return setAppSession(accountResponse({ok:true,redirect:sessionRedirect??'/'}),raw,expires);
 }catch(e){
  if(e instanceof EmailVerificationRequired)return accountResponse({error:e.message,confirmationRequired:true},403);
  if(e instanceof AccountRequestError)return accountResponse({error:e.message},e.status);
  if(e instanceof z.ZodError||e instanceof SyntaxError)return accountResponse({error:'Bitte E-Mail, Nutzername und Passwort prüfen.'},400);
  if(e instanceof Error&&e.message==='Dieser Spielerzugang wurde deaktiviert.')return accountResponse({error:e.message},403);
  return accountResponse({error:'Anmeldung momentan nicht verfügbar. Bitte die Migrationen bis 020_username_search.sql und die Konfiguration prüfen.'},503);
 }
 }
 const response=await handleRequest();return switching&&!authenticated?clearAppSession(response):response;
}
