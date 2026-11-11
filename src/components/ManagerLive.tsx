'use client';
import {translate as translateUi,useLanguage} from '../i18n/locale';

import {useEffect,useState} from 'react';
import AccessQr from './AccessQr';
export default function ManagerLive(){useLanguage();
 const [manager,setManager]=useState<{name:string;url:string}|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;fetch('/api/managers?mine=1',{cache:'no-store'}).then(r=>r.json()).then(d=>{if(active){if(d.error)setError(d.error);else setManager(d.manager);}}).catch(()=>{if(active)setError('Zuschauerlink nicht verfügbar.');});return()=>{active=false;};},[]);
 return <div className="form"><p>{translateUi("Dieser feste Zuschauerlink zeigt dein aktuelles Turnier auf einer eigenen Seite ohne Navigation. Für ein bestimmtes Turnier findest du den Zuschauerlink über „Zuschauerlink“.")}</p>{manager?<AccessQr url={manager.url} label={translateUi("Zuschauerzugang ")+manager.name}/>:<p>{translateUi(error)||translateUi("Zuschauerlink wird geladen …")}</p>}</div>;
}
