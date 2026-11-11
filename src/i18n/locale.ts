'use client';
import {useSyncExternalStore} from 'react';
import en from './en.json';
export type Language='de'|'en';
let language:Language='de';
const listeners=new Set<()=>void>();
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export const getLanguage=()=>language;
export function useLanguage(){return useSyncExternalStore(subscribe,getLanguage,()=> 'de' as Language);}
export function setLanguage(next:Language){language=next;try{localStorage.setItem('dartbracket-language',next);}catch{}if(typeof document!=='undefined')document.documentElement.lang=next;listeners.forEach(fn=>fn());}
const entries=en as Record<string,string>;
export function translate(source:string,...values:(string|number)[]):string{
 const key=source.replace(/\bOwner\b/g,'Admin');
 let result=language==='en'?(entries[key]??key):key;
 if(language==='en'&&!entries[key]){
  const darts=key.match(/^Board-Daten empfangen · (\d+) Dart\(s\) erkannt$/);
  const reference=key.match(/^(.*) Referenz: ([a-f0-9-]+)$/);
  const pause=key.match(/^Bitte noch (\d+) Sekunden warten\.$/);
  const providerPause=key.match(/^Der E-Mail-Dienst verlangt eine Pause\. Erneut versuchen in (\d+) Sekunden\.$/);
  const migration=key.match(/^Bitte (.*?) im Supabase SQL Editor ausführen\.$/);
  if(darts)result=translate('Board-Daten empfangen · {0} Dart(s) erkannt',darts[1]);
  else if(reference)result=translate(reference[1])+' Reference: '+reference[2];
  else if(pause)result=translate('Bitte noch {0} Sekunden warten.',pause[1]);
  else if(providerPause)result=translate('Der E-Mail-Dienst verlangt eine Pause. Erneut versuchen in {0} Sekunden.',providerPause[1]);
  else if(migration)result='Please run '+migration[1]+' in the Supabase SQL editor.';
 }
 return result.replace(/\{(\d+)\}/g,(match,index)=>values[Number(index)]===undefined?match:String(values[Number(index)]));
}
