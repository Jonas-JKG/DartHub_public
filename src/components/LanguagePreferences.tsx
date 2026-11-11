'use client';
import {useEffect} from 'react';
import {setLanguage,useLanguage,translate as translateUi} from '../i18n/locale';
export function LanguageInit(){useEffect(()=>{try{setLanguage(localStorage.getItem('dartbracket-language')==='en'?'en':'de');}catch{}const changed=(e:StorageEvent)=>{if(e.key==='dartbracket-language')setLanguage(e.newValue==='en'?'en':'de');};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[]);return null;}
export default function LanguagePreferences(){const language=useLanguage();return <section className="panel form"><h2>{translateUi('Sprache')}</h2><label>{translateUi('Sprache der Oberfläche')}<select aria-label={translateUi('Sprache der Oberfläche')} value={language} onChange={e=>setLanguage(e.target.value==='en'?'en':'de')}><option value="de">Deutsch</option><option value="en">English</option></select></label></section>;}
