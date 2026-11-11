'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import {useEffect,useState} from 'react';
import AccessQr from './AccessQr';
export default function SpectatorShare({id}:{id:string}){useLanguage();const [url,setUrl]=useState(''),[error,setError]=useState('');useEffect(()=>{const controller=new AbortController();void fetch('/api/watch',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);return d;}).then(d=>setUrl(d.url)).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[id]);return <div className="form">{translateUi(error)&&<p role="alert" className="form-error">{translateUi(error)}</p>}<p>{translateUi("Dieser Link zeigt ausschließlich dieses Turnier, ohne Seitenmenü.")}</p>{url?<AccessQr url={url} label="Zuschaueransicht"/>:!translateUi(error)&&<p>{translateUi("Zuschauerlink wird geladen …")}</p>}</div>;}
