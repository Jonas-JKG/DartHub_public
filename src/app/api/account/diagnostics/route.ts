import {NextRequest} from 'next/server';
import {accountResponse} from '../../../../server/account-http';
import {primarySession} from '../../../../server/play-context';
import {db} from '../../../../server/repositories/supabase';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(r:NextRequest){
 try{
  const session=await primarySession(r);
  if(session?.role!=='owner'||session.manager_id)return accountResponse({error:'Nur für den Admin.'},403);
  const url=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!),callback=new URL('/auth/confirm',process.env.APP_ORIGIN??r.url);
  const result=await fetch(new URL('/auth/v1/settings',url),{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!},cache:'no-store',signal:AbortSignal.timeout(10000)});
  const settings=result.ok?await result.json():null;
  const [schema,events]=await Promise.all([
   db().from('managers').select('email_verification_version').limit(1),
   db().from('account_mail_events').select('id,created_at,operation,stage,outcome,provider_code,provider_status').order('created_at',{ascending:false}).limit(10)
  ]);
  return accountResponse({version:19,projectHost:url.hostname,callbackUrl:callback.href,sameOrigin:callback.origin===r.nextUrl.origin,migrationReady:!schema.error&&!events.error,
   providerReachable:result.ok,emailEnabled:typeof settings?.external?.email==='boolean'?settings.external.email:null,
   confirmEmail:typeof settings?.mailer_autoconfirm==='boolean'?!settings.mailer_autoconfirm:null,
   providerSignupsEnabled:typeof settings?.disable_signup==='boolean'?!settings.disable_signup:null,
   events:events.data??[]});
 }catch{return accountResponse({error:'Die Diagnose konnte Supabase nicht erreichen. Vercel-Konfiguration und Auth Logs prüfen.'},503);}
}
