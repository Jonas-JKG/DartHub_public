'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import PasswordInput from './PasswordInput';
import {useEffect,useState,useRef} from 'react';
import Link from 'next/link';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {loginDestination} from '../client/post-login';
export default function AccountConfirm(){useLanguage();
 const authRef=useRef<SupabaseClient|null>(null),confirmation=useRef<Promise<{accessToken:string;recovery:boolean}>|null>(null);
 const [message,setMessage]=useState('E-Mail-Bestätigung wird geprüft …'),[recover,setRecover]=useState(false),[password,setPassword]=useState(''),[client,setClient]=useState<SupabaseClient|null>(null),[busy,setBusy]=useState(false);
 useEffect(()=>{
  let stopped=false;
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY){setMessage('Die E-Mail-Anmeldung ist noch nicht eingerichtet.');return;}
  if(!authRef.current)authRef.current=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{detectSessionInUrl:true,persistSession:false,autoRefreshToken:false,storageKey:'dartbracket-confirm'}});
  const auth=authRef.current;setClient(auth);
  if(!confirmation.current)confirmation.current=(async()=>{
   const q=new URLSearchParams(window.location.search),fragment=new URLSearchParams(window.location.hash.slice(1));
   const recovery=q.get('type')==='recovery'||fragment.get('type')==='recovery';
   if(q.has('token_hash')){const result=await auth.auth.verifyOtp({token_hash:q.get('token_hash')!,type:recovery?'recovery':q.get('type')==='magiclink'?'magiclink':'signup'});if(result.error)throw Error('Bestätigungslink ungültig oder abgelaufen.');}
   const {data,error}=await auth.auth.getSession();if(error||!data.session)throw Error('Bestätigungslink ungültig oder abgelaufen. Bitte einen neuen Link anfordern.');
   window.history.replaceState(null,'','/auth/confirm');
   return {accessToken:data.session.access_token,recovery};
  })();
  async function confirm(){try{
   const result=await confirmation.current!;if(stopped)return;
   if(result.recovery){setRecover(true);setMessage('Lege dein neues Passwort fest.');return;}
   const r=await fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'session',accessToken:result.accessToken})}),d=await r.json();if(!r.ok)throw Error(d.error??'Anmeldung nicht möglich.');await auth.auth.signOut({scope:'local'});if(!stopped)window.location.replace(d.redirect==='/account/setup'?d.redirect:loginDestination(d.redirect??'/'));
  }catch(e){if(!stopped)setMessage(e instanceof Error?e.message:'Bestätigung fehlgeschlagen.');}}
  void confirm();return()=>{stopped=true;};
 },[]);
 return <main className="player-pick"><h1>{translateUi("E-Mail bestätigen")}</h1><p role="status">{translateUi(message)}</p>{recover&&<form className="form panel" onSubmit={async e=>{e.preventDefault();if(!client)return;setBusy(true);try{const {error}=await client.auth.updateUser({password});if(error)throw Error('Passwort konnte nicht geändert werden.');const {data}=await client.auth.getSession();if(data.session){const revoked=await fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'revoke-sessions',accessToken:data.session.access_token})});if(!revoked.ok)throw Error("Passwort geändert; bitte erneut anmelden und bestehende Sitzungen über den Admin sperren lassen.");}await client.auth.signOut({scope:'local'});setRecover(false);setPassword('');setMessage('Passwort geändert. Du kannst dich jetzt anmelden.');}catch(e){setMessage(e instanceof Error?e.message:'Änderung fehlgeschlagen.');}finally{setBusy(false);}}}><label>{translateUi("Neues Passwort")}<PasswordInput visibilityLabel={translateUi("Neues Passwort")} autoComplete="new-password" minLength={12} maxLength={200} required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="button primary" disabled={busy}>{translateUi("Passwort speichern")}</button></form>}<Link className="button ghost" href="/login">{translateUi("Zur Anmeldung")}</Link></main>;
}
