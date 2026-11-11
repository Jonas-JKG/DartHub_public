'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import Welcome from './Welcome';
import AccountDataCache from './AccountDataCache';
const AccountContext=createContext(false);
export const useAccountAccess=()=>useContext(AccountContext);
type Access={account:boolean|null;setupRequired:boolean;error:string};
export default function AccessBoundary({children}:{children:ReactNode}){useLanguage();
 const path=usePathname(),publicPage=path==='/login'||path==='/auth/confirm'||path.startsWith('/watch/');
 const [state,setState]=useState<Access>({account:null,setupRequired:false,error:''});
 const currentPath=useRef(path);currentPath.current=path;
 useEffect(()=>{
  if(publicPage){setState({account:null,setupRequired:false,error:''});return;}
  const controller=new AbortController();let active=true,running=false;
  async function check(){if(running)return;running=true;try{
   const r=await fetch('/api/identity',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])}),d=await r.json();
   if(!r.ok)throw Error(d.error??'Anmeldung konnte nicht geprüft werden.');
   if(active)setState({account:d.signedIn===true&&d.role==='owner',setupRequired:d.setupRequired===true,error:''});
  }catch(e){if(active&&!controller.signal.aborted)setState(old=>({...old,error:e instanceof Error?e.message:translateUi("Anmeldung konnte nicht geprüft werden.")}));}finally{running=false;}}
  void check();const timer=setInterval(()=>void check(),30000);
  window.addEventListener('focus',check);window.addEventListener('dartbracket:auth-changed',check);
  return()=>{active=false;controller.abort();clearInterval(timer);window.removeEventListener('focus',check);window.removeEventListener('dartbracket:auth-changed',check);};
 },[publicPage]);
 useEffect(()=>{if(!publicPage&&state.account&&state.setupRequired&&path!=='/account/setup'){try{localStorage.setItem('after-account-login',currentPath.current);}catch{}window.location.replace('/account/setup');}},[publicPage,state.account,state.setupRequired,path]);
 if(publicPage)return <AccountContext.Provider value={false}>{children}</AccountContext.Provider>;
 if(state.account===null||state.setupRequired&&path!=='/account/setup')return <main className="access-screen">{state.error?<><h1>{translateUi("Anmeldung prüfen")}</h1><p role="alert">{state.error}</p><button className="button primary" onClick={()=>window.location.reload()}>{translateUi("Erneut versuchen")}</button></>:<p role="status">{translateUi("Anmeldung wird geprüft …")}</p>}</main>;
 if(!state.account)return <Welcome next={path}/>;
 return <AccountContext.Provider value><AccountDataCache>{children}</AccountDataCache></AccountContext.Provider>;
}
