'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useAccountAccess} from './AccessBoundary';
import {translate as translateUi,useLanguage} from '../i18n/locale';

export default function AccountAuthButton(){
 useLanguage();
 const signedIn=useAccountAccess();
 const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 async function signOut(){
  if(busy)return;
  setBusy(true);setFailed(false);
  try{
   const response=await fetch('/api/app',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'}),signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('logout');
   // A full navigation also discards all private in-memory account caches.
   window.location.replace('/login');
  }catch{setFailed(true);setBusy(false);}
 }
 if(!signedIn)return <Link className="role-button" href="/login">{translateUi('Anmelden')}</Link>;
 return <div className="top-actions">{failed&&<span role="alert">{translateUi('Abmelden fehlgeschlagen.')}</span>}<button className="role-button" disabled={busy} onClick={()=>void signOut()}>{translateUi(busy?'Bitte warten …':'Abmelden')}</button></div>;
}
