'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import PasswordInput from './PasswordInput';
import {useState} from 'react';
import {loginDestination} from '../client/post-login';
export default function AdminLogin(){useLanguage();const [password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);return <form className="panel form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const r=await fetch('/api/app',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',payload:{password}})}),d=await r.json();if(!r.ok||d.error)throw Error(d.error??'Anmeldung fehlgeschlagen.');window.location.href=loginDestination(d.redirect??'/');}catch(e){setError(e instanceof Error?e.message:'Anmeldung fehlgeschlagen.');}finally{setBusy(false);}}}><label>{translateUi("Admin-Passwort")}<PasswordInput visibilityLabel={translateUi("Admin-Passwort")} autoComplete="current-password" required maxLength={200} value={password} onChange={e=>setPassword(e.target.value)}/></label>{translateUi(error)&&<p role="alert">{translateUi(error)}</p>}<button className="button primary" disabled={busy}>{translateUi("Admin anmelden")}</button></form>;}
